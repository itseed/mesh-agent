# Design: Move Claude Spawn from API to Orchestrator

**Date:** 2026-04-28  
**Status:** Approved

## Problem

`apps/api` calls `claude` CLI directly via `execFile` in two places:

- `lib/lead.ts` — `runLead()` and `runLeadSynthesis()` for Lead LLM responses
- `routes/settings.ts` — `GET /settings/claude/test` to verify the CLI is available

The API's `Dockerfile.dev` does not install `claude`, so any spawn attempt throws `ENOENT` inside Docker. Only the orchestrator container has `claude` installed (via `npm install -g @anthropic-ai/claude-code`) and `~/.claude` mounted.

## Goal

API never spawns `claude` directly. All claude execution goes through the orchestrator over HTTP on the internal Docker network.

## Architecture

```
Before:
  API → execFile('claude') ← ENOENT (claude not in API container)

After:
  API ──HTTP──► Orchestrator → execFile('claude') ✓
                (has claude + ~/.claude mounted)
```

## New Orchestrator Endpoints

### `POST /prompt`

One-shot claude execution for Lead LLM calls.

**Request body:**

```json
{
  "prompt": "<full prompt string>",
  "timeoutMs": 60000
}
```

**Response (200):**

```json
{ "stdout": "<raw CLI output>" }
```

**Response (504):** timeout exceeded  
**Response (500):** claude exited with non-zero or other error

Implementation: `execFileAsync(env.CLAUDE_CMD, ['--output-format', 'json', '-p', prompt], { timeout, env: process.env })`

No auth required — orchestrator is internal-only on the Docker network (same as existing `/sessions`).

### `GET /health/claude`

Tests whether claude is available and returns the actual binary path.

**Response (200):**

```json
{ "ok": true, "version": "1.x.x", "cmd": "/usr/local/bin/claude" }
```

**Response (200, not ok):**

```json
{ "ok": false, "error": "spawn error message", "cmd": "/usr/local/bin/claude" }
```

Implementation: runs `which claude` to get the resolved binary path (fallback to `env.CLAUDE_CMD` if `which` fails), then `claude --version`.

## API Changes

### `lib/lead.ts`

Replace both `execFileAsync(cmd, ...)` calls with `fetch`:

```ts
// runLead
const res = await fetch(`${ORCHESTRATOR_URL}/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, timeoutMs: 60_000 }),
  signal: AbortSignal.timeout(65_000),
});
if (!res.ok) throw new Error(`Orchestrator error: ${res.status}`);
const { stdout } = await res.json();
```

`ORCHESTRATOR_URL` is already in the API's env (`http://orchestrator:4802`).

### `routes/settings.ts`

**Test endpoint** (`GET /settings/claude/test`): forward to `GET /health/claude` on orchestrator, return its response as-is.

**Remove `settings:claude:cmd` Redis key** — the override was for telling the API which binary to use. Since the API no longer spawns claude, this setting has no effect. Remove:

- `POST /settings/claude/cmd`
- `DELETE /settings/claude/cmd`
- `GET /settings` field `cli.cmd` / `cli.source`

The orchestrator's `CLAUDE_CMD` env var remains the canonical place to configure the binary.

## Error Handling

| Scenario                                 | Behavior                                     |
| ---------------------------------------- | -------------------------------------------- |
| Orchestrator unreachable                 | API throws, returns 503 to client            |
| claude timeout (60s Lead, 45s Synthesis) | Orchestrator returns 504; API surfaces error |
| claude exits non-zero                    | Orchestrator returns 500 with error message  |

## Files Changed

| File                                           | Change                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/orchestrator/src/routes/sessions.ts` | Add `POST /prompt` and `GET /health/claude` handlers (or extract to new file `routes/prompt.ts`) |
| `packages/orchestrator/src/server.ts`          | Register new route file                                                                          |
| `apps/api/src/lib/lead.ts`                     | Replace `execFileAsync` with `fetch` to orchestrator                                             |
| `apps/api/src/routes/settings.ts`              | Test endpoint proxies to orchestrator; remove cmd override routes                                |
| `apps/api/src/env.ts`                          | Confirm `ORCHESTRATOR_URL` is present (likely already is)                                        |

## Out of Scope

- Streaming claude output (not needed — Lead calls are one-shot `-p`)
- Auth on orchestrator endpoints (internal Docker network only)
- Moving agent session dispatch (already goes through orchestrator `/sessions`)

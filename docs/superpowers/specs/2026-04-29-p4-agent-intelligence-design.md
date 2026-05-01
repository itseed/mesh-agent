# P4 — Agent Intelligence Design

## Goal

Make agents project-aware by (A) injecting a project brief + auto-read codebase docs (CLAUDE.md / README.md) into every agent prompt, and (B) persisting agent run summaries per project so future agents see what has been done before.

## Architecture

```
Setup (once per project):
  User writes brief in Project Settings → POST /projects/:id/context
    → save brief to projectContext table
    → auto-read CLAUDE.md + README.md from workspacePath (or first path in paths)
    → save result to autoContext column in projectContext table

Agent dispatch (every run):
  dispatchAgent()
    → buildContextBlock(projectId, fastify) — loads brief + autoContext + last 5 outcomes
    → prepend context block to agent prompt before sending to orchestrator

Agent completes (POST /internal/agent-complete):
    → extract summary + prUrl from outputLog (already done)
    → insert agentOutcomes: { projectId, role, summary, prUrl }
```

---

## Data Structures

### New table: projectContext

1:1 with projects. Stores user-written brief and auto-read file content.

```typescript
export const projectContext = pgTable('project_context', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  brief: text('brief').notNull().default(''),
  autoContext: text('auto_context').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

### New table: agentOutcomes

One row per agent run. Stores the extracted summary and PR URL for future context injection.

```typescript
export const agentOutcomes = pgTable('agent_outcomes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  summary: text('summary').notNull(),
  prUrl: text('pr_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

Index: `(projectId, createdAt DESC)` for fast "last N outcomes" queries.

---

## Context Block Format

Injected as a prefix to every agent prompt. Empty sections are omitted entirely.

```
## Project Context
{brief}

## Codebase Overview
{autoContext — truncated to 2000 characters}

## Recent Work
- [backend] Built REST endpoints for auth — PR: https://github.com/.../pull/12
- [frontend] Fixed login form validation — no PR
- [qa] All tests passing after auth changes — no PR
```

Rules:

- `## Project Context` block omitted if `brief` is empty
- `## Codebase Overview` block omitted if `autoContext` is empty
- `## Recent Work` block omitted if no outcomes exist for this project
- `autoContext` hard-capped at 2000 characters (truncated with `…` if longer)
- Last 5 outcomes only (ordered by `createdAt DESC`)

---

## Auto-Read Logic

On `POST /projects/:id/context`, after saving `brief`, the API reads files in this order from `project.workspacePath ?? Object.values(project.paths)[0]`:

1. Try `CLAUDE.md` — if exists, read up to 4000 chars
2. Try `README.md` — if exists and CLAUDE.md not found or empty, read up to 4000 chars
3. Combine: if both found, concat with `\n\n---\n\n` separator, cap at 4000 chars total
4. Store result in `autoContext`

If the directory is not accessible (path doesn't exist, permission error), store `autoContext = ''` and log a warning — do not fail the request.

---

## Files

| File                                  | Action     | Responsibility                                                                    |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `packages/shared/src/schema.ts`       | **Modify** | Add `projectContext` and `agentOutcomes` tables                                   |
| `apps/api/src/lib/context-builder.ts` | **Create** | `buildContextBlock(projectId, fastify)` — loads and formats context for injection |
| `apps/api/src/lib/dispatch.ts`        | **Modify** | Call `buildContextBlock()` and prepend to prompt                                  |
| `apps/api/src/routes/projects.ts`     | **Modify** | `POST /projects/:id/context` — save brief, trigger auto-read                      |
| `apps/api/src/routes/internal.ts`     | **Modify** | Insert `agentOutcomes` row after agent complete                                   |
| `apps/web/app/projects/page.tsx`      | **Modify** | Add "Project Brief" textarea + autoContext preview in project detail panel        |
| `apps/web/lib/api.ts`                 | **Modify** | Add `projects.saveContext(id, brief)`                                             |

No orchestrator changes needed — context is injected into the prompt string before dispatch.

---

## API Endpoint

### POST /projects/:id/context

Request body:

```json
{ "brief": "This is a Next.js + Fastify monorepo. Frontend in apps/web, API in apps/api." }
```

Steps:

1. Load project — 404 if not found
2. Determine read directory: `project.workspacePath ?? Object.values(project.paths ?? {})[0]`
3. Read CLAUDE.md and/or README.md (best-effort — skip on error)
4. Upsert `projectContext` row with `brief` and `autoContext`
5. Return `{ ok: true, autoContext }` — client shows preview

### GET /projects/:id/context (optional — for loading existing brief into the form)

Returns `{ brief, autoContext, updatedAt }` or `{ brief: '', autoContext: '', updatedAt: null }` if no row exists.

---

## context-builder.ts

```typescript
export async function buildContextBlock(
  projectId: string | null,
  fastify: FastifyInstance,
): Promise<string>;
```

- If `projectId` is null → return `''`
- Load `projectContext` row for this project (returns null if not found)
- Load last 5 `agentOutcomes` rows for this project ordered by `createdAt DESC`
- Build and return the formatted context block (see format above)
- Never throws — catches errors and returns `''`

---

## dispatch.ts change

In `dispatchAgent()`, add context injection:

```typescript
export async function dispatchAgent(
  role: string,
  workingDir: string,
  prompt: string,
  context: { projectId?: string | null; taskId?: string | null; createdBy?: string | null },
  systemPrompt?: string,
  repoUrl?: string,
  fastify?: FastifyInstance, // NEW optional param — needed for context lookup
): Promise<{ id: string | null; error?: string }>;
```

When `fastify` and `context.projectId` are provided:

```typescript
const contextBlock = await buildContextBlock(context.projectId, fastify);
const enrichedPrompt = contextBlock ? `${contextBlock}\n\n---\n\n${prompt}` : prompt;
```

All callers that have access to `fastify` (routes/chat.ts, routes/tasks.ts, routes/internal.ts) pass it in. Callers without `fastify` omit it — dispatch runs unchanged.

---

## internal.ts change

After the existing `buildSummary()` + `extractPrUrl()` calls, insert an agentOutcomes row when `projectId` is present:

```typescript
if (projectId) {
  try {
    await fastify.db.insert(agentOutcomes).values({
      projectId,
      role,
      summary,
      prUrl: prUrl ?? null,
    });
  } catch (err) {
    fastify.log.warn({ err, projectId, role }, 'Failed to insert agentOutcomes');
  }
}
```

---

## UI — Project Settings

In `apps/web/app/projects/page.tsx`, inside the `ProjectDetail` component (right panel), add a new **"Context"** tab alongside the existing tabs:

```
[ Details ] [ GitHub ] [ Context ]   ← new tab
```

Context tab content:

- Textarea: "Project Brief" — `rows={6}`, placeholder: `"Describe this project for agents: tech stack, conventions, key files…"`
- Read-only preview: "Codebase Overview (auto-read)" — shows `autoContext` truncated to 500 chars with "…" if longer, or `"No CLAUDE.md or README.md found"` if empty
- Save button: calls `api.projects.saveContext(id, brief)` → refreshes autoContext preview
- On load: calls `api.projects.getContext(id)` to populate existing values

---

## Spec Self-Review

1. **Placeholder scan:** No TBDs. All endpoint steps defined. Auto-read logic specifies file order, char caps, error handling. Context block format specifies exactly when each section is omitted.

2. **Internal consistency:** `dispatchAgent` gets optional `fastify` — callers that already have it pass it; old callers unchanged (backward compat). `buildContextBlock` returns `''` on any error — dispatch continues even if context lookup fails.

3. **Scope check:** Two tables, one new lib file, changes to 5 existing files, one new API endpoint. Fits in a single implementation plan.

4. **Ambiguity:** "Last 5 outcomes" is explicit. `autoContext` cap is 2000 chars (at injection) — the stored value can be up to 4000 chars (as read from disk). Both caps are explicit. `GET /projects/:id/context` is marked optional — implement only if needed for the UI load.

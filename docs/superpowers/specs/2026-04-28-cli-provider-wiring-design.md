# Design: CLI Provider Wiring

**Date:** 2026-04-28
**Status:** Approved

## Problem

Frontend (`AgentRolePanel.tsx`) มี UI เลือก CLI provider (claude/gemini/cursor) และส่ง `cli` field ใน payload แล้ว แต่ `POST /agents` route ไม่รับ field นี้ → orchestrator ไม่ได้รับ → agent รันด้วย claude เสมอโดยไม่สนใจ choice ของ user

## Goal

Wire `cli` field ตลอด chain: UI → API → Orchestrator → AgentSession → ใช้ CLI ที่ถูกต้อง + persist ลง DB

## Out of Scope

- Auto dispatch (tasks.ts flow) ยังใช้ claude เสมอ — user เลือก provider ได้เฉพาะ manual dispatch จาก Agent page
- Validation against `cliProviders` DB table (enabled/disabled) — trust client input
- Qwen — deferred to v2

## Data Flow

```
AgentRolePanel.tsx
  POST /agents body: { role, prompt, projectId, cli: "gemini" }
        ↓
apps/api/src/routes/agents.ts
  dispatchSchema: + cli: z.enum(['claude','gemini','cursor']).optional()
  → orchestrator body: { ..., cliProvider: body.cli }
  → DB: agentSessions.cliProvider = body.cli (fire-and-forget after sessionId received)
        ↓
packages/orchestrator/src/routes/sessions.ts
  createSessionSchema: + cliProvider: z.enum(['claude','gemini','cursor']).optional()
  → manager.createSession({ ..., cliProvider })
        ↓
packages/orchestrator/src/manager.ts
  CreateSessionOpts: + cliProvider?: CliProvider | null
  → new AgentSession({ ..., cliProvider })
        ↓
AgentSession.start()
  buildCliArgs(cliProvider, ...) → { cmd, args }
  spawn(cmd, args, { cwd: workingDir })
```

## Files Changed

| File                                           | Change                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/api/src/routes/agents.ts`                | Add `cli` to dispatchSchema; forward as `cliProvider` to orchestrator; save to DB |
| `packages/orchestrator/src/routes/sessions.ts` | Add `cliProvider` to schema; pass to manager                                      |
| `packages/orchestrator/src/manager.ts`         | Add `cliProvider` to `CreateSessionOpts`; pass to `new AgentSession`              |
| `packages/orchestrator/Dockerfile.dev`         | Add gemini CLI + cursor CLI install                                               |
| `packages/orchestrator/Dockerfile`             | Add gemini CLI + cursor CLI install                                               |

**Unchanged:** `session.ts`, `buildCliArgs()`, `schema.ts`, `AgentRolePanel.tsx`, `dispatch.ts`

## CLI Installation in Dockerfile

**Gemini:**

```dockerfile
RUN npm install -g @google/gemini-cli
```

**Cursor:** ทำตาม official docs ที่ https://cursor.com/docs/cli/installation (agent ต้องอ่าน docs จริงก่อน implement เพื่อใช้ method ที่ถูกต้อง)

## Error Handling

| Scenario                         | Behavior                                                    |
| -------------------------------- | ----------------------------------------------------------- |
| `cli` ไม่ได้ส่งมา                | undefined → orchestrator ใช้ claude fallback (พฤติกรรมเดิม) |
| `cli` ค่าไม่ถูก enum             | Zod reject → 400 Bad Request                                |
| Binary ของ CLI ไม่มีใน container | Session เริ่ม → fail ด้วย ENOENT → error ใน session log     |
| DB save cliProvider fail         | log warning เท่านั้น ไม่ block response                     |

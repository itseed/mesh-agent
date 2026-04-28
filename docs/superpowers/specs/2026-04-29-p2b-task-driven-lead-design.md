# P2b — Task-Driven Lead Design

## Goal

Allow users to create tasks with attached business requirement files (images, PDFs, markdown), then trigger Lead to read the task and dispatch agents in waves automatically — no chat confirmation step, activity log tracks every action.

## Architecture

```
User กด "Start with Lead" บน backlog task
  → POST /tasks/:id/start
      → load task + attachments from DB
      → download each attachment: MinIO → /tmp/mesh-agent/tasks/{taskId}/
      → runLeadTask(task, localFilePaths, projectPaths)
          → Lead LLM reads files via Read tool → output waves JSON
      → dispatch Wave 0 agents (reuse P2a wave-store)
      → save WaveState (rootTaskId = task.id)
      → log taskActivity: lead.wave.planned
      → update task: stage in_progress

Wave N complete (P2a internal.ts handler)
  → log taskActivity: wave.dispatched / wave.completed / wave.done
  → (existing wave auto-trigger unchanged)
```

## Files

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/api/src/lib/wave-store.ts` | **Modify** | Add `rootTaskId?: string` to `WaveState` |
| `apps/api/src/lib/lead-task.ts` | **Create** | `runLeadTask()` — task-driven Lead prompt (always outputs waves, no chat/clarify intent) |
| `apps/api/src/routes/tasks.ts` | **Modify** | Add `POST /tasks/:id/start` endpoint |
| `apps/api/src/routes/internal.ts` | **Modify** | Log `taskActivities` entries on wave events |
| `apps/web/lib/api.ts` | **Modify** | Add `tasks.start(id)` |
| `apps/web/components/kanban/TaskDetailPanel.tsx` | **Modify** | "Start with Lead" button in header |
| `apps/web/components/kanban/TaskCard.tsx` | **Modify** | "▶" button on backlog cards |

---

## Data Structures

### WaveState (updated)

Add `rootTaskId` so internal.ts can log activity to the correct task:

```typescript
export interface WaveState {
  // ... existing fields ...
  rootTaskId?: string   // NEW — the task that triggered this wave run
}
```

### taskActivities entries

All use the existing `taskActivities` table (`type` is free text, `payload` is jsonb):

| type | payload | when |
|------|---------|------|
| `lead.wave.planned` | `{ waveCount, waves: [{roles, brief}] }` | after Lead plans, before dispatch |
| `wave.dispatched` | `{ waveIndex, roles: string[] }` | when a wave's agents start |
| `wave.completed` | `{ waveIndex, success: boolean, summary: string }` | when a wave finishes |
| `wave.done` | `{ totalWaves }` | after final wave completes |

---

## lead-task.ts

`runLeadTask()` is simpler than the chat Lead: it always outputs waves (no chat/clarify intent). Input: task title, description, local file paths, project paths by role.

### Prompt

```
You are the Lead of a software development team. A task is ready to be worked on.

Task: {title}
Description: {description or "(no description)"}

Working directories by role:
  frontend: /path/a
  backend: /path/b

{if localFilePaths.length > 0}
Attached requirement files — read each one with the Read tool before planning:
- /tmp/mesh-agent/tasks/{taskId}/mockup.png
- /tmp/mesh-agent/tasks/{taskId}/spec.md
{/if}

Plan the work as sequential waves of agents.
Roles within one wave run in parallel. Use multiple waves only when there is a clear sequential dependency.

Output valid JSON only — no markdown, no commentary:
{
  "waves": [
    { "roles": [{"slug":"backend","reason":"..."}], "brief": "what wave 1 does" },
    { "roles": [{"slug":"frontend"}], "brief": "what wave 2 does" }
  ],
  "taskBrief": {
    "title": "<task title, <=80 chars>",
    "description": "<expanded description for the agents>"
  }
}

Role slugs allowed: frontend, backend, mobile, devops, designer, qa, reviewer
Reply in Thai if the task title is Thai, otherwise English.
```

### Return type

```typescript
interface LeadTaskResult {
  waves: LeadWave[]
  taskBrief: { title: string; description: string }
}
```

No intent field — it always plans.

---

## POST /tasks/:id/start

```
1. Load task from DB — 404 if not found
2. Check task.stage === 'backlog' — 409 if already started
3. Load task attachments from DB
4. For each attachment: download from MinIO to /tmp/mesh-agent/tasks/{taskId}/{fileName}
   - mkdir -p the directory
   - Skip attachments that fail to download (log warn, continue)
5. Load project paths (if task.projectId exists)
6. runLeadTask(task, localFilePaths, projectPaths)
7. dispatch Wave 0 agents (same logic as POST /chat/dispatch)
8. Save WaveState with rootTaskId = task.id
9. Insert taskActivity: lead.wave.planned
10. Insert taskActivity: wave.dispatched (wave 0)
11. Update task: stage = 'in_progress', agentRole = null (multi-role now)
12. Return { ok: true, waves, sessionIds }
```

### Error handling

- MinIO not configured → 503
- Lead LLM fails → 502, do not change task stage
- No agents successfully dispatched → 500, revert task stage to 'backlog'

---

## internal.ts — Wave Activity Logging

When `rootTaskId` is present in WaveState, log `taskActivities` after each wave event:

- Wave N all done, eval says proceed → log `wave.completed` + `wave.dispatched` (next wave)
- Final wave done → log `wave.completed` + `wave.done`
- eval says ask user → log `wave.completed` (mark as needing input)

Activity entries use `actorId = null` (system-generated).

---

## UI — "Start with Lead" Button

### TaskDetailPanel (header)

Show button when `task.stage === 'backlog'`. After click: disable button, call `api.tasks.start(task.id)`, on success refresh task + activities.

```
[header area]  [title]  ...  [▶ Start with Lead]  [🗑]
```

Button state: idle → loading ("Starting…") → hides when stage changes to in_progress.

### TaskCard (Kanban)

Small `▶` icon button — appears on hover for backlog cards only. Calls same endpoint. On success, card moves to in_progress column via WebSocket event.

---

## Spec Self-Review

- No TBD or placeholders remain.
- `rootTaskId` in WaveState links wave events back to the originating task.
- MinIO download step is best-effort (skip failed files, proceed with rest) — Lead still plans with available attachments.
- Task stage check (409) prevents double-start.
- Lead failure (502) does not mutate task — safe to retry.
- Activity log entries use existing `taskActivities` table with no schema change.
- P2a wave progression in internal.ts unchanged — only adds activity logging when `rootTaskId` present.
- UI button hides when stage leaves backlog — prevents re-trigger.

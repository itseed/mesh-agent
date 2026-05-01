# P2b — Task-Driven Lead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click "Start with Lead" on any backlog task — Lead reads the task description and attached files, plans waves, and auto-dispatches agents while logging every action to the task's Activity tab.

**Architecture:** `POST /tasks/:id/start` downloads attachments from MinIO to `/tmp/mesh-agent/tasks/{taskId}/`, calls `runLeadTask()` which prompts Lead LLM (Claude via orchestrator) to output `waves[]` JSON, then dispatches Wave 0 using the existing P2a wave-store. `WaveState` carries `rootTaskId` so internal.ts can write `taskActivities` entries at every wave event.

**Tech Stack:** Fastify, Drizzle ORM, MinIO SDK, ioredis, TypeScript, Next.js (React)

---

## File Map

| File                                             | Action     | Responsibility                                                                 |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------ |
| `apps/api/src/lib/wave-store.ts`                 | **Modify** | Add `rootTaskId?: string` to `WaveState`                                       |
| `apps/api/src/lib/lead-task.ts`                  | **Create** | `runLeadTask()` — task-driven Lead prompt, always outputs `waves[]`            |
| `apps/api/src/routes/tasks.ts`                   | **Modify** | Add `POST /tasks/:id/start` — download attachments, call Lead, dispatch wave 0 |
| `apps/api/src/routes/internal.ts`                | **Modify** | Log `taskActivities` entries on wave events when `rootTaskId` present          |
| `apps/web/lib/api.ts`                            | **Modify** | Add `tasks.start(id)`                                                          |
| `apps/web/components/kanban/TaskDetailPanel.tsx` | **Modify** | "Start with Lead" button in header (backlog only)                              |
| `apps/web/components/kanban/TaskCard.tsx`        | **Modify** | `▶` hover button on backlog cards                                              |

---

### Task 1: Add rootTaskId to WaveState

**Files:**

- Modify: `apps/api/src/lib/wave-store.ts`

- [ ] **Step 1: Add `rootTaskId` field to WaveState interface**

In `apps/api/src/lib/wave-store.ts`, find the `WaveState` interface and add one field:

```typescript
export interface WaveState {
  proposalId: string;
  waves: LeadWave[];
  currentWave: number;
  taskTitle: string;
  taskDescription: string;
  projectId: string | null;
  baseBranch: string;
  branchSuffix: string;
  createdBy: string;
  imagePaths: string[];
  pendingSessions: string[];
  completedSessions: WaveCompletedSession[];
  rootTaskId?: string; // NEW — task.id that triggered this wave run (for activity logging)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/lib/wave-store.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): add rootTaskId to WaveState for activity logging"
```

---

### Task 2: Create lead-task.ts

**Files:**

- Create: `apps/api/src/lib/lead-task.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/lib/lead-task.ts
import type { LeadWave } from './wave-store.js';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4802';

export interface LeadTaskResult {
  waves: LeadWave[];
  taskBrief: { title: string; description: string };
}

async function callOrchestrator(prompt: string): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeoutMs: 60_000 }),
    signal: AbortSignal.timeout(65_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Orchestrator error ${res.status}: ${body.error ?? 'unknown'}`);
  }
  const { stdout } = (await res.json()) as { stdout: string };
  return stdout;
}

function buildPrompt(
  task: { title: string; description?: string | null },
  localFilePaths: string[],
  projectPaths: Record<string, string>,
): string {
  const pathLines = Object.entries(projectPaths)
    .map(([role, dir]) => `  ${role}: ${dir}`)
    .join('\n');

  const fileLines = localFilePaths.map((p) => `- ${p}`).join('\n');

  return [
    'You are the Lead of a software development team. A task is ready to be worked on.',
    '',
    `Task: ${task.title}`,
    `Description: ${task.description?.trim() || '(no description provided)'}`,
    '',
    Object.keys(projectPaths).length > 0
      ? `Working directories by role:\n${pathLines}`
      : '(no project paths configured — agents will use their default working directory)',
    '',
    localFilePaths.length > 0
      ? `Attached requirement files — use the Read tool on each path before planning:\n${fileLines}`
      : '(no attachments)',
    '',
    'Plan the work as sequential waves of agents.',
    'Roles within one wave run in parallel. Use multiple waves only when there is a clear sequential dependency (e.g. backend API must exist before frontend can integrate it).',
    'Strongly prefer a single wave with one role unless the task genuinely requires multiple sequential steps.',
    '',
    'Role slugs allowed: frontend, backend, mobile, devops, designer, qa, reviewer',
    '',
    'Output valid JSON only — no markdown, no commentary:',
    '{',
    '  "waves": [',
    '    { "roles": [{"slug":"backend","reason":"..."}], "brief": "what wave 1 accomplishes" },',
    '    { "roles": [{"slug":"frontend"}], "brief": "what wave 2 accomplishes" }',
    '  ],',
    '  "taskBrief": {',
    '    "title": "<task title, <=80 chars>",',
    '    "description": "<expanded description for the agents — include relevant file paths from attachments if any>"',
    '  }',
    '}',
    '',
    'Reply in Thai if the task title is Thai, otherwise English.',
  ].join('\n');
}

const ALLOWED_ROLES = new Set([
  'frontend',
  'backend',
  'mobile',
  'devops',
  'designer',
  'qa',
  'reviewer',
]);

function parseResult(stdout: string): LeadTaskResult {
  let text = stdout.trim();
  try {
    const w = JSON.parse(text);
    if (typeof w.result === 'string') text = w.result.trim();
    else if (typeof w.stdout === 'string') text = w.stdout.trim();
  } catch {
    /* not wrapped */
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Lead task returned no JSON. Raw: ${text.slice(0, 300)}`);

  const parsed = JSON.parse(match[0]) as Record<string, unknown>;

  const wavesRaw = Array.isArray(parsed.waves) ? parsed.waves : [];
  const waves: LeadWave[] = [];
  for (const w of wavesRaw) {
    if (!w || typeof w !== 'object') continue;
    const wObj = w as Record<string, unknown>;
    const rolesRaw = Array.isArray(wObj.roles) ? wObj.roles : [];
    const roles: LeadWave['roles'] = [];
    for (const r of rolesRaw) {
      if (!r || typeof r !== 'object') continue;
      const slug = String((r as Record<string, unknown>).slug ?? '').toLowerCase();
      if (!ALLOWED_ROLES.has(slug)) continue;
      const reason = (r as Record<string, unknown>).reason;
      roles.push({ slug, reason: typeof reason === 'string' ? reason : undefined });
    }
    if (roles.length === 0) continue;
    const brief = typeof wObj.brief === 'string' ? wObj.brief.trim() : '';
    waves.push({ roles, brief });
  }
  if (waves.length === 0) throw new Error('Lead task returned no valid waves');

  const briefRaw = parsed.taskBrief as Record<string, unknown> | undefined;
  const title = typeof briefRaw?.title === 'string' ? briefRaw.title.trim().slice(0, 80) : '';
  const description = typeof briefRaw?.description === 'string' ? briefRaw.description.trim() : '';
  if (!title || !description) throw new Error('Lead task returned invalid taskBrief');

  return { waves, taskBrief: { title, description } };
}

export async function runLeadTask(
  task: { title: string; description?: string | null },
  localFilePaths: string[],
  projectPaths: Record<string, string>,
): Promise<LeadTaskResult> {
  const stdout = await callOrchestrator(buildPrompt(task, localFilePaths, projectPaths));
  return parseResult(stdout);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/lib/lead-task.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): add runLeadTask for task-driven wave dispatch"
```

---

### Task 3: Add POST /tasks/:id/start

**Files:**

- Modify: `apps/api/src/routes/tasks.ts`

- [ ] **Step 1: Add imports at top of tasks.ts**

After the existing imports, add:

```typescript
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { taskActivities, taskAttachments } from '@meshagent/shared';
import { runLeadTask } from '../lib/lead-task.js';
import { saveWaveState, indexSession, type WaveState } from '../lib/wave-store.js';
import { dispatchAgent, buildGitInstructions } from '../lib/dispatch.js';
import { findRoleBySlug } from '../lib/roles.js';
```

(Skip any already imported — `tasks`, `projects`, `eq`, `FastifyInstance` etc. are likely already there.)

- [ ] **Step 2: Add `POST /tasks/:id/start` route**

Add this route inside `export async function taskRoutes(fastify: FastifyInstance)`, after the existing routes:

```typescript
fastify.post('/tasks/:id/start', { preHandler }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const userId = (request.user as { id: string }).id;

  // 1. Load task
  const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return reply.status(404).send({ error: 'Task not found' });
  if (task.stage !== 'backlog') {
    return reply.status(409).send({ error: `Task is already ${task.stage} — cannot start again` });
  }
  if (!fastify.minio) {
    return reply.status(503).send({ error: 'MinIO not configured — file attachments unavailable' });
  }

  // 2. Load attachments
  const attachments = await fastify.db
    .select()
    .from(taskAttachments)
    .where(eq(taskAttachments.taskId, id));

  // 3. Download attachments to local tmp dir
  const tmpDir = `/tmp/mesh-agent/tasks/${id}`;
  await mkdir(tmpDir, { recursive: true });
  const localFilePaths: string[] = [];

  for (const att of attachments) {
    const localPath = path.join(tmpDir, att.fileName);
    try {
      const url = await fastify.minio.presignedGetObject(fastify.minioBucket, att.storageKey, 300);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MinIO returned ${res.status}`);
      await writeFile(localPath, Buffer.from(await res.arrayBuffer()));
      localFilePaths.push(localPath);
    } catch (err) {
      fastify.log.warn(
        { err, storageKey: att.storageKey },
        'Failed to download attachment — skipping',
      );
    }
  }

  // 4. Load project paths
  let projectPaths: Record<string, string> = {};
  let baseBranch = 'main';
  if (task.projectId) {
    const [proj] = await fastify.db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    if (proj) {
      projectPaths = (proj.paths as Record<string, string>) ?? {};
      baseBranch = proj.baseBranch ?? 'main';
    }
  }

  // 5. Run Lead to plan waves
  let leadResult: Awaited<ReturnType<typeof runLeadTask>>;
  try {
    leadResult = await runLeadTask(task, localFilePaths, projectPaths);
  } catch (err: any) {
    fastify.log.error({ err, taskId: id }, 'Lead task planning failed');
    return reply.status(502).send({ error: `Lead planning failed: ${err?.message ?? 'unknown'}` });
  }

  const { waves, taskBrief } = leadResult;

  // 6. Log: lead.wave.planned
  await fastify.db.insert(taskActivities).values({
    taskId: id,
    actorId: null,
    type: 'lead.wave.planned',
    payload: {
      waveCount: waves.length,
      waves: waves.map((w) => ({ roles: w.roles.map((r) => r.slug), brief: w.brief })),
    },
  });

  // 7. Dispatch Wave 0
  const branchSuffix = Date.now().toString(36);
  const gitInstructions = buildGitInstructions(baseBranch, branchSuffix);
  const imageBlock =
    localFilePaths.length > 0
      ? `\n\n## Attached requirement files\nUse the Read tool on each path before starting work:\n${localFilePaths.map((p) => `- ${p}`).join('\n')}`
      : '';
  const fullPrompt = `${taskBrief.description}${imageBlock}${gitInstructions}`;

  const wave0 = waves[0];
  const pendingSessions: string[] = [];

  for (const r of wave0.roles) {
    const role = await findRoleBySlug(fastify, r.slug);
    if (!role) {
      fastify.log.warn({ slug: r.slug }, 'start: skipping unknown role');
      continue;
    }

    const agentWorkingDir = projectPaths[r.slug] ?? Object.values(projectPaths)[0] ?? '/tmp';

    const [agentTask] = await fastify.db
      .insert(tasks)
      .values({
        title: taskBrief.title,
        description: taskBrief.description,
        stage: 'in_progress',
        agentRole: r.slug,
        projectId: task.projectId ?? null,
        parentTaskId: id,
      })
      .returning();

    const result = await dispatchAgent(
      r.slug,
      agentWorkingDir,
      fullPrompt,
      {
        projectId: task.projectId ?? null,
        taskId: agentTask?.id ?? null,
        createdBy: userId,
      },
      role?.systemPrompt ?? undefined,
    );

    if (!result.id && agentTask?.id) {
      await fastify.db
        .update(tasks)
        .set({ stage: 'backlog', status: 'blocked', updatedAt: new Date() })
        .where(eq(tasks.id, agentTask.id));
    }

    if (result.id) {
      pendingSessions.push(result.id);
      await indexSession(fastify.redis, result.id, id); // proposalId = task.id (unique per run)
    }
  }

  if (pendingSessions.length === 0) {
    // Revert — nothing dispatched
    return reply.status(500).send({ error: 'No agents could be dispatched' });
  }

  // 8. Log: wave.dispatched (wave 0)
  await fastify.db.insert(taskActivities).values({
    taskId: id,
    actorId: null,
    type: 'wave.dispatched',
    payload: { waveIndex: 0, roles: wave0.roles.map((r) => r.slug) },
  });

  // 9. Save WaveState (only if multiple waves)
  if (waves.length > 1) {
    const waveState: WaveState = {
      proposalId: id, // use task.id as the proposalId for this run
      waves,
      currentWave: 0,
      taskTitle: taskBrief.title,
      taskDescription: taskBrief.description,
      projectId: task.projectId ?? null,
      baseBranch,
      branchSuffix,
      createdBy: userId,
      imagePaths: localFilePaths,
      pendingSessions,
      completedSessions: [],
      rootTaskId: id,
    };
    await saveWaveState(fastify.redis, waveState);
  }

  // 10. Update task stage
  await fastify.db
    .update(tasks)
    .set({ stage: 'in_progress', updatedAt: new Date() })
    .where(eq(tasks.id, id));

  await fastify.redis.publish(
    'tasks:events',
    JSON.stringify({
      type: 'task.stage',
      taskId: id,
      stage: 'in_progress',
      projectId: task.projectId ?? null,
    }),
  );

  return { ok: true, waveCount: waves.length, pendingSessions };
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/routes/tasks.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): add POST /tasks/:id/start for task-driven wave dispatch"
```

---

### Task 4: Update internal.ts — log taskActivities on wave events

**Files:**

- Modify: `apps/api/src/routes/internal.ts`

- [ ] **Step 1: Add taskActivities import**

In `apps/api/src/routes/internal.ts`, find the existing shared import line and add `taskActivities`:

```typescript
import { tasks, taskComments, taskActivities } from '@meshagent/shared';
```

- [ ] **Step 2: Add activity logging helper before internalRoutes**

Add this function before `export async function internalRoutes(...)`:

```typescript
async function logTaskActivity(
  fastify: FastifyInstance,
  taskId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fastify.db.insert(taskActivities).values({ taskId, actorId: null, type, payload });
    await fastify.redis.publish(
      TASKS_CHANNEL,
      JSON.stringify({ type: 'task.activity', taskId, activityType: type }),
    );
  } catch (err) {
    fastify.log.warn({ err, taskId, type }, 'Failed to log task activity');
  }
}
```

- [ ] **Step 3: Log wave events in the wave progression block**

In `apps/api/src/routes/internal.ts`, inside the wave progression try-block (the one that calls `runWaveEvaluation`), add activity logging at each branch. Find the section starting with `if (state.pendingSessions.length > 0)` and update the `else` block (when all sessions done) as follows:

```typescript
} else {
  // All agents in current wave done — evaluate
  const hasNextWave = state.currentWave + 1 < state.waves.length
  const evalResult = await runWaveEvaluation(state)

  // Log wave.completed for root task (if any)
  if (state.rootTaskId) {
    const waveSuccess = state.completedSessions.every((s) => s.success)
    const waveSummary = state.completedSessions.map((s) => `[${s.role}] ${s.summary}`).join('; ')
    await logTaskActivity(fastify, state.rootTaskId, 'wave.completed', {
      waveIndex: state.currentWave,
      success: waveSuccess,
      summary: waveSummary,
    })
  }

  if (!hasNextWave) {
    // Final wave complete
    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'lead' as const,
      content: evalResult.message,
      timestamp: Date.now(),
    })
    if (state.rootTaskId) {
      await logTaskActivity(fastify, state.rootTaskId, 'wave.done', {
        totalWaves: state.waves.length,
      })
    }
    await deleteWaveState(fastify.redis, proposalId)
  } else if (evalResult.ask) {
    // Lead unsure — surface to user
    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'lead' as const,
      content: evalResult.message,
      timestamp: Date.now(),
    })
    await deleteWaveState(fastify.redis, proposalId)
  } else if (evalResult.proceed) {
    // Auto-proceed to next wave
    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'lead' as const,
      content: evalResult.message,
      timestamp: Date.now(),
    })
    const nextWaveIndex = state.currentWave + 1
    const newPending = await dispatchNextWave(fastify, state, nextWaveIndex)
    state.currentWave = nextWaveIndex
    state.pendingSessions = newPending
    state.completedSessions = []
    if (state.rootTaskId) {
      await logTaskActivity(fastify, state.rootTaskId, 'wave.dispatched', {
        waveIndex: nextWaveIndex,
        roles: state.waves[nextWaveIndex]?.roles.map((r) => r.slug) ?? [],
      })
    }
    if (newPending.length > 0) {
      await updateWaveState(fastify.redis, state)
    } else {
      await deleteWaveState(fastify.redis, proposalId)
    }
  } else {
    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'lead' as const,
      content: evalResult.message,
      timestamp: Date.now(),
    })
    await deleteWaveState(fastify.redis, proposalId)
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/routes/internal.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): log taskActivities on wave events"
```

---

### Task 5: Add tasks.start() to api.ts + UI buttons

**Files:**

- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/kanban/TaskDetailPanel.tsx`
- Modify: `apps/web/components/kanban/TaskCard.tsx`

- [ ] **Step 1: Add tasks.start() to api.ts**

In `apps/web/lib/api.ts`, inside the `tasks` object, add:

```typescript
start: (id: string) =>
  request<{ ok: boolean; waveCount: number; pendingSessions: string[] }>(
    `/tasks/${id}/start`,
    { method: 'POST' },
  ),
```

- [ ] **Step 2: Add "Start with Lead" button to TaskDetailPanel header**

In `apps/web/components/kanban/TaskDetailPanel.tsx`, add state for the start button near the top of the component (with the other `useState` calls):

```typescript
const [starting, setStarting] = useState(false);
```

Then add `handleStart` function before the `return` statement:

```typescript
async function handleStart() {
  setStarting(true);
  try {
    await api.tasks.start(task.id);
    setLocalTask((t: any) => ({ ...t, stage: 'in_progress' }));
    // Refresh activities tab
    const fresh = await api.tasks.activities(task.id);
    setActivities(fresh);
  } catch (e: any) {
    alert(e.message ?? 'Start failed');
  } finally {
    setStarting(false);
  }
}
```

In the header JSX, find the `{confirmDelete ? ... : <button onClick={() => setConfirmDelete(true)}>🗑</button>}` block. Add the Start button **before** the delete button (only when `localTask.stage === 'backlog'`):

```tsx
{
  localTask.stage === 'backlog' && !confirmDelete && (
    <button
      onClick={handleStart}
      disabled={starting}
      className="text-[12px] px-2.5 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50 shrink-0"
      title="Let Lead analyze and dispatch agents"
    >
      {starting ? 'Starting…' : '▶ Start with Lead'}
    </button>
  );
}
```

- [ ] **Step 3: Add ▶ button to TaskCard for backlog tasks**

In `apps/web/components/kanban/TaskCard.tsx`, add `onStart` to the props interface:

```typescript
interface TaskCardProps {
  task: any;
  projects?: any[];
  allTasks?: any[];
  onClick?: () => void;
  onDelete?: (id: string) => void;
  onStart?: (id: string) => void; // NEW
  stageColor?: string;
  isDragging?: boolean;
}
```

Update the destructured props:

```typescript
export function TaskCard({ task, projects, allTasks, onClick, onDelete, onStart, stageColor, isDragging }: TaskCardProps) {
```

In the JSX, find the `{onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}>✕</button>}` block. Add the Start button next to it:

```tsx
<div className="flex items-center gap-1 shrink-0">
  {onStart && task.stage === 'backlog' && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onStart(task.id);
      }}
      className="text-accent opacity-0 group-hover:opacity-100 transition-all text-[12px] px-1 hover:text-accent/70"
      title="Start with Lead"
    >
      ▶
    </button>
  )}
  {onDelete && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDelete(task.id);
      }}
      className="text-dim hover:text-danger opacity-0 group-hover:opacity-100 transition-all text-[13px] shrink-0"
    >
      ✕
    </button>
  )}
</div>
```

- [ ] **Step 4: Wire onStart in KanbanColumn or KanbanBoard**

In `apps/web/components/kanban/KanbanBoard.tsx` or `KanbanColumn.tsx` (wherever `TaskCard` is rendered), add `onStart` handler. Find where `<TaskCard>` is rendered and add:

```tsx
onStart={async (id) => {
  try {
    await api.tasks.start(id)
    // Board refreshes via WebSocket task.stage event
  } catch (e: any) {
    alert(e.message ?? 'Start failed')
  }
}}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/web/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/web/tsconfig.json --noEmit 2>&1 | head -30
```

Expected: 0 errors (or only pre-existing errors unrelated to this change)

- [ ] **Step 6: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add \
  apps/web/lib/api.ts \
  apps/web/components/kanban/TaskDetailPanel.tsx \
  apps/web/components/kanban/TaskCard.tsx
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(web): add Start with Lead button to task card and detail panel"
```

---

## Self-Review

**Spec coverage:**

- ✅ `rootTaskId` in WaveState — Task 1
- ✅ `runLeadTask()` with task context + local file paths — Task 2
- ✅ `POST /tasks/:id/start`: download attachments, call Lead, dispatch wave 0, save WaveState — Task 3
- ✅ Task stage → `in_progress` after dispatch — Task 3
- ✅ 409 if task already started — Task 3
- ✅ 503 if MinIO not configured — Task 3
- ✅ 502 if Lead fails (task stage NOT mutated) — Task 3
- ✅ `lead.wave.planned` activity entry — Task 3
- ✅ `wave.dispatched` activity entry (wave 0) — Task 3
- ✅ `wave.completed`, `wave.dispatched` (subsequent waves), `wave.done` in internal.ts — Task 4
- ✅ `tasks.start()` API client — Task 5
- ✅ "Start with Lead" button in TaskDetailPanel header (backlog only, hides when in_progress) — Task 5
- ✅ `▶` hover button on TaskCard for backlog tasks — Task 5

**Placeholder scan:** No TBDs, no vague steps, all code blocks complete.

**Type consistency:**

- `runLeadTask` returns `LeadTaskResult` (defined in lead-task.ts) — used in tasks.ts Task 3 ✓
- `WaveState.rootTaskId` added in Task 1, used in tasks.ts (Task 3) and internal.ts (Task 4) ✓
- `indexSession(fastify.redis, sessionId, proposalId)` — in tasks.ts uses `task.id` as `proposalId`, same key the wave-store uses ✓
- `logTaskActivity` helper defined in Task 4 Step 2, used in Task 4 Step 3 ✓
- `api.tasks.start(id)` defined in Task 5 Step 1, called in Steps 2 and 4 ✓

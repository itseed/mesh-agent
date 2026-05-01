# P3 — Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically dispatch a reviewer agent after every successful dev agent run; reviewer runs tests + code review, then either passes the task to "done" or blocks it and re-dispatches fix agents (up to 2 auto-fix attempts before escalating to user).

**Architecture:** `triggerQualityGate()` in `quality-gate.ts` dispatches a real reviewer agent session, saves `QualityGateState` in Redis (`qg:state:{taskId}`), and indexes the session (`qg:session:{sessionId}` → taskId). When the reviewer calls `/internal/agent-complete`, `internal.ts` detects it via the index, parses `verdict_json` from the TASK_COMPLETE block, and handles pass (task → "done") or block (dispatch fix agents via new WaveState with rootTaskId, increment attempt). At attempt ≥ 2, escalates to user in chat.

**Tech Stack:** Fastify, ioredis, Drizzle ORM (PostgreSQL), TypeScript, existing `dispatchAgent` + wave-store infrastructure

---

## File Map

| File                               | Action     | Responsibility                                                                                                          |
| ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/quality-gate.ts` | **Create** | `QualityGateState` interface, Redis CRUD helpers, `buildReviewerPrompt()`, `parseVerdictJson()`, `triggerQualityGate()` |
| `apps/api/src/routes/internal.ts`  | **Modify** | QG reviewer detection + verdict handling; trigger QG at wave final and single-agent completion                          |

---

### Task 1: Create quality-gate.ts

**Files:**

- Create: `apps/api/src/lib/quality-gate.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/lib/quality-gate.ts
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { taskActivities } from '@meshagent/shared';
import { dispatchAgent } from './dispatch.js';
import { findRoleBySlug } from './roles.js';

const QG_TTL = 86400; // 24 h

export interface QualityGateState {
  taskId: string;
  reviewerSessionId: string;
  prUrls: string[];
  projectId: string | null;
  projectPaths: Record<string, string>;
  baseBranch: string;
  branchSuffix: string;
  createdBy: string;
  attempt: number; // starts at 0; escalate when attempt >= 2
  taskTitle: string;
  taskDescription: string;
}

export interface ReviewerVerdict {
  verdict: 'pass' | 'block';
  fixRoles: { slug: string; brief: string }[];
  issues: { severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; description: string }[];
  message: string;
}

const qgStateKey = (taskId: string) => `qg:state:${taskId}`;
const qgSessionKey = (sessionId: string) => `qg:session:${sessionId}`;

export async function saveQgState(redis: Redis, state: QualityGateState): Promise<void> {
  await redis.set(qgStateKey(state.taskId), JSON.stringify(state), 'EX', QG_TTL);
}

export async function getQgState(redis: Redis, taskId: string): Promise<QualityGateState | null> {
  const raw = await redis.get(qgStateKey(taskId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QualityGateState;
  } catch {
    return null;
  }
}

export async function deleteQgState(redis: Redis, taskId: string): Promise<void> {
  await redis.del(qgStateKey(taskId));
}

export async function indexQgSession(
  redis: Redis,
  sessionId: string,
  taskId: string,
): Promise<void> {
  await redis.set(qgSessionKey(sessionId), taskId, 'EX', QG_TTL);
}

export async function lookupQgSession(redis: Redis, sessionId: string): Promise<string | null> {
  return redis.get(qgSessionKey(sessionId));
}

export async function removeQgSessionIndex(redis: Redis, sessionId: string): Promise<void> {
  await redis.del(qgSessionKey(sessionId));
}

function buildReviewerPrompt(opts: {
  taskTitle: string;
  taskDescription: string;
  prUrls: string[];
  baseBranch: string;
}): string {
  const prLines = opts.prUrls.map((u) => `- ${u}`).join('\n');
  return [
    'You are a code reviewer. Your job is to check a completed task before it is marked done.',
    '',
    `Task: ${opts.taskTitle}`,
    `Description: ${opts.taskDescription}`,
    '',
    'PRs to review:',
    prLines,
    '',
    'For each PR:',
    '1. Extract the PR number from the URL and run: gh pr checkout <number>',
    `2. git diff origin/${opts.baseBranch}...HEAD — inspect all changes`,
    '3. Review for: OWASP Top 10 security issues, logic correctness, edge cases, code quality',
    '4. Discover and run the test suite:',
    '   - Check package.json "scripts.test" → npm test',
    '   - Check for pytest.ini or pyproject.toml → pytest',
    '   - Check for vitest.config.ts or jest.config.ts → npx vitest run or npx jest',
    '   - If no test suite found: note it in summary, do NOT block for this reason',
    '',
    'Block criteria (verdict must be "block"):',
    '  - Any issue with severity CRITICAL',
    '  - Any test command exits non-zero',
    'Pass criteria (verdict must be "pass"):',
    '  - No CRITICAL issues AND all tests pass (or no test suite found)',
    '  - MEDIUM and LOW issues are fine — include them in issues[] but still pass',
    '',
    'Output ONLY this TASK_COMPLETE block — no other text after it:',
    'TASK_COMPLETE',
    'summary: <1-2 sentence summary of what you found>',
    'verdict_json: {"verdict":"pass","fixRoles":[],"issues":[],"message":"<shown in chat to user>"}',
    'END_TASK_COMPLETE',
  ].join('\n');
}

export function parseVerdictJson(outputLog: string): ReviewerVerdict | null {
  const block = outputLog.match(/TASK_COMPLETE[\s\S]*?END_TASK_COMPLETE/);
  if (!block) return null;
  const match = block[0].match(/verdict_json:\s*(\{[\s\S]*?\})(?:\n|$)/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as ReviewerVerdict;
  } catch {
    return null;
  }
}

export async function triggerQualityGate(
  fastify: FastifyInstance,
  taskId: string,
  prUrls: string[],
  projectPaths: Record<string, string>,
  opts: {
    projectId: string | null;
    baseBranch: string;
    branchSuffix: string;
    createdBy: string;
    taskTitle: string;
    taskDescription: string;
  },
): Promise<void> {
  // Read existing QG state to preserve attempt counter across retry loops
  const existing = await getQgState(fastify.redis, taskId);
  const attempt = existing?.attempt ?? 0;

  const reviewerWorkingDir = Object.values(projectPaths)[0] ?? '/tmp';
  const prompt = buildReviewerPrompt({
    taskTitle: opts.taskTitle,
    taskDescription: opts.taskDescription,
    prUrls,
    baseBranch: opts.baseBranch,
  });

  const role = await findRoleBySlug(fastify, 'reviewer');
  const result = await dispatchAgent(
    'reviewer',
    reviewerWorkingDir,
    prompt,
    { projectId: opts.projectId, taskId: null, createdBy: opts.createdBy },
    role?.systemPrompt ?? undefined,
  );

  if (!result.id) {
    fastify.log.warn(
      { taskId, error: result.error },
      'Quality gate reviewer dispatch failed — skipping',
    );
    return;
  }

  const state: QualityGateState = {
    taskId,
    reviewerSessionId: result.id,
    prUrls,
    projectId: opts.projectId,
    projectPaths,
    baseBranch: opts.baseBranch,
    branchSuffix: opts.branchSuffix,
    createdBy: opts.createdBy,
    attempt,
    taskTitle: opts.taskTitle,
    taskDescription: opts.taskDescription,
  };
  await saveQgState(fastify.redis, state);
  await indexQgSession(fastify.redis, result.id, taskId);

  try {
    await fastify.db.insert(taskActivities).values({
      taskId,
      actorId: null,
      type: 'quality_gate.started',
      payload: { attempt, prUrls },
    });
  } catch (err) {
    fastify.log.warn({ err, taskId }, 'Failed to log quality_gate.started activity');
  }
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
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/lib/quality-gate.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): add quality-gate lib — triggerQualityGate + Redis helpers"
```

---

### Task 2: Add QG reviewer handler to internal.ts

**Files:**

- Modify: `apps/api/src/routes/internal.ts`

This task adds the handler that fires when the **reviewer** agent (not a dev agent) calls `/internal/agent-complete`. It detects the reviewer via `qg:session` Redis index, parses `verdict_json`, and handles pass / block / escalate.

- [ ] **Step 1: Add imports at the top of internal.ts**

After the existing imports, add:

```typescript
import {
  lookupQgSession,
  removeQgSessionIndex,
  getQgState,
  saveQgState,
  deleteQgState,
  parseVerdictJson,
  type QualityGateState,
} from '../lib/quality-gate.js';
```

- [ ] **Step 2: Add the QG reviewer handler block**

Inside `fastify.post('/internal/agent-complete', ...)`, **immediately after** the `const body = bodySchema.parse(request.body)` line and **before** the `const prUrl = extractPrUrl(...)` line, insert:

```typescript
// ── Quality Gate reviewer completion ──────────────────────────────────────
// Check if this session belongs to a QG reviewer BEFORE any regular logic.
// Reviewer sessions have taskId: null so the task-update block below is a
// no-op for them, but we return early to avoid synthesis.
try {
  const qgTaskId = await lookupQgSession(fastify.redis, body.sessionId);
  if (qgTaskId) {
    await removeQgSessionIndex(fastify.redis, body.sessionId);
    const qgState = await getQgState(fastify.redis, qgTaskId);
    if (qgState) {
      const verdict = parseVerdictJson(body.outputLog);

      if (verdict?.verdict === 'pass') {
        // ── Pass ──────────────────────────────────────────────────────────
        await fastify.db
          .update(tasks)
          .set({ stage: 'done', updatedAt: new Date() })
          .where(eq(tasks.id, qgTaskId));
        await fastify.redis.publish(
          TASKS_CHANNEL,
          JSON.stringify({
            type: 'task.stage',
            taskId: qgTaskId,
            stage: 'done',
            projectId: qgState.projectId,
          }),
        );
        await logTaskActivity(fastify, qgTaskId, 'quality_gate.passed', {
          attempt: qgState.attempt,
          issueCount: verdict.issues.length,
        });
        await pushChatMessage(fastify, {
          id: crypto.randomUUID(),
          role: 'lead' as const,
          content: verdict.message,
          timestamp: Date.now(),
        });
        await deleteQgState(fastify.redis, qgTaskId);
      } else if (verdict?.verdict === 'block') {
        // ── Block ─────────────────────────────────────────────────────────
        await logTaskActivity(fastify, qgTaskId, 'quality_gate.blocked', {
          attempt: qgState.attempt,
          issues: verdict.issues,
        });
        await pushChatMessage(fastify, {
          id: crypto.randomUUID(),
          role: 'lead' as const,
          content: verdict.message,
          timestamp: Date.now(),
        });

        if (qgState.attempt < 2 && verdict.fixRoles.length > 0) {
          // Dispatch fix agents as a new single-wave WaveState
          const newBranchSuffix = Date.now().toString(36);
          const newProposalId = crypto.randomUUID();
          const issueLines = verdict.issues
            .map((i) => `- [${i.severity}] ${i.description}`)
            .join('\n');
          const fixDescription = `${qgState.taskDescription}\n\n## Issues to Fix (from Quality Gate):\n${issueLines}`;

          const fixWaveState: WaveState = {
            proposalId: newProposalId,
            waves: [
              {
                roles: verdict.fixRoles.map((r) => ({ slug: r.slug, reason: r.brief })),
                brief: 'Fix issues found by quality gate review',
              },
            ],
            currentWave: 0,
            taskTitle: qgState.taskTitle,
            taskDescription: fixDescription,
            projectId: qgState.projectId,
            baseBranch: qgState.baseBranch,
            branchSuffix: newBranchSuffix,
            createdBy: qgState.createdBy,
            imagePaths: [],
            pendingSessions: [],
            completedSessions: [],
            rootTaskId: qgTaskId,
          };

          const pendingFixSessions: string[] = [];
          for (const r of verdict.fixRoles) {
            const roleObj = await findRoleBySlug(fastify, r.slug);
            if (!roleObj) {
              fastify.log.warn({ slug: r.slug }, 'QG block: skipping unknown fix role');
              continue;
            }
            const workingDir =
              qgState.projectPaths[r.slug] ?? Object.values(qgState.projectPaths)[0] ?? '/tmp';
            const fixPrompt = `${fixDescription}\n${buildGitInstructions(qgState.baseBranch, newBranchSuffix)}`;
            const result = await dispatchAgent(
              r.slug,
              workingDir,
              fixPrompt,
              { projectId: qgState.projectId, taskId: null, createdBy: qgState.createdBy },
              roleObj.systemPrompt ?? undefined,
            );
            if (result.id) {
              pendingFixSessions.push(result.id);
              await indexSession(fastify.redis, result.id, newProposalId);
              await pushChatMessage(fastify, {
                id: crypto.randomUUID(),
                role: 'agent' as const,
                content: `[${r.slug}] Fix agent เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`,
                timestamp: Date.now(),
                meta: { agentRole: r.slug, sessionId: result.id },
              });
            }
          }

          if (pendingFixSessions.length > 0) {
            fixWaveState.pendingSessions = pendingFixSessions;
            await saveWaveState(fastify.redis, fixWaveState);
            // Increment attempt in QG state (reviewer will read this on next trigger)
            await saveQgState(fastify.redis, { ...qgState, attempt: qgState.attempt + 1 });
          } else {
            // No fix agents dispatched — escalate immediately
            await logTaskActivity(fastify, qgTaskId, 'quality_gate.escalated', {
              attempt: qgState.attempt,
              reason: 'no_fix_agents_dispatched',
            });
            await pushChatMessage(fastify, {
              id: crypto.randomUUID(),
              role: 'lead' as const,
              content:
                'Quality gate blocked แต่ไม่สามารถ dispatch fix agents ได้ — กรุณาแก้ไขด้วยตนเอง',
              timestamp: Date.now(),
            });
            await deleteQgState(fastify.redis, qgTaskId);
          }
        } else {
          // Max attempts reached — escalate to user
          await logTaskActivity(fastify, qgTaskId, 'quality_gate.escalated', {
            attempt: qgState.attempt,
            reason: 'max_attempts_reached',
          });
          await pushChatMessage(fastify, {
            id: crypto.randomUUID(),
            role: 'lead' as const,
            content: `Quality gate ล้มเหลวหลัง ${qgState.attempt + 1} ครั้ง — กรุณาแก้ไขปัญหาด้วยตนเองแล้วแจ้งกลับมา`,
            timestamp: Date.now(),
          });
          await deleteQgState(fastify.redis, qgTaskId);
        }
      } else {
        // No valid verdict_json — log warning, treat as passed to avoid infinite loop
        fastify.log.warn(
          { sessionId: body.sessionId, qgTaskId },
          'QG reviewer returned no valid verdict_json — treating as pass',
        );
        await fastify.db
          .update(tasks)
          .set({ stage: 'done', updatedAt: new Date() })
          .where(eq(tasks.id, qgTaskId));
        await fastify.redis.publish(
          TASKS_CHANNEL,
          JSON.stringify({
            type: 'task.stage',
            taskId: qgTaskId,
            stage: 'done',
            projectId: qgState.projectId,
          }),
        );
        await deleteQgState(fastify.redis, qgTaskId);
      }
    }
    return reply.status(200).send({ ok: true });
  }
} catch (err) {
  fastify.log.warn(
    { err, sessionId: body.sessionId },
    'Quality gate reviewer handler failed — continuing as regular agent',
  );
}
// ── End Quality Gate reviewer check ──────────────────────────────────────
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/routes/internal.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): handle quality gate reviewer completion in agent-complete"
```

---

### Task 3: Trigger QG at wave final completion

**Files:**

- Modify: `apps/api/src/routes/internal.ts`

This task changes the wave final-wave handler: instead of pushing a "wave.done" chat message and marking the task done, it calls `triggerQualityGate()` when PR URLs were found. Fall back to existing behavior when no PRs.

- [ ] **Step 1: Add triggerQualityGate import**

Add to the import block at the top of `internal.ts`:

```typescript
import { triggerQualityGate } from '../lib/quality-gate.js';
```

- [ ] **Step 2: Also add projects import if not already present**

Ensure `projects` is imported from `@meshagent/shared`:

```typescript
import { tasks, taskComments, taskActivities, projects } from '@meshagent/shared';
```

(It's already imported from the P2b work — verify it's there.)

- [ ] **Step 3: Replace the final-wave block**

Find this block in `internal.ts` (inside the wave progression try block):

```typescript
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
```

Replace it with:

```typescript
if (!hasNextWave) {
  // Final wave complete — attempt quality gate if any PRs were created
  const prUrls = state.completedSessions
    .map((s) => s.summary.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0])
    .filter((u): u is string => Boolean(u))

  let projectPaths: Record<string, string> = {}
  if (state.projectId) {
    const [proj] = await fastify.db
      .select()
      .from(projects)
      .where(eq(projects.id, state.projectId))
      .limit(1)
    if (proj) projectPaths = (proj.paths as Record<string, string>) ?? {}
  }

  if (state.rootTaskId && prUrls.length > 0) {
    // Hand off to Quality Gate — reviewer will move task to "done" on pass
    await logTaskActivity(fastify, state.rootTaskId, 'wave.done', {
      totalWaves: state.waves.length,
    })
    await triggerQualityGate(fastify, state.rootTaskId, prUrls, projectPaths, {
      projectId: state.projectId,
      baseBranch: state.baseBranch,
      branchSuffix: state.branchSuffix,
      createdBy: state.createdBy,
      taskTitle: state.taskTitle,
      taskDescription: state.taskDescription,
    })
  } else {
    // No PRs or no rootTaskId — existing behavior
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
  }
  await deleteWaveState(fastify.redis, proposalId)
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
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): trigger quality gate after final wave completes"
```

---

### Task 4: Trigger QG for single-agent completion

**Files:**

- Modify: `apps/api/src/routes/internal.ts`

Single-agent tasks (dispatched from chat, not wave-based): when `success && prUrl`, trigger QG instead of leaving task at "review". Task stage stays "in_progress" until reviewer passes.

- [ ] **Step 1: Change the stage calculation**

Find this line near the top of the agent-complete handler (after the QG reviewer block you added in Task 2):

```typescript
const stage = success ? (prUrl ? 'review' : 'done') : 'in_progress';
```

Replace with:

```typescript
// When success + prUrl, QG controls the final "done" transition — keep in_progress
const stage = success ? (prUrl ? 'in_progress' : 'done') : 'in_progress';
```

- [ ] **Step 2: Add single-agent QG trigger**

Find the end of the file where non-wave synthesis happens:

```typescript
// Single-agent synthesis only when not part of a wave
if (!handledByWave) {
  void synthesizeAfterCompletion(fastify, {
    agentRole: role,
    success,
    summary,
    prUrl,
  });
}
```

Replace with:

```typescript
// Single-agent completion — trigger QG if PR was created, otherwise synthesize
if (!handledByWave) {
  if (success && prUrl && taskId) {
    // Load task + project to get paths for QG
    void (async () => {
      try {
        const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!task) return;

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

        await triggerQualityGate(fastify, taskId, [prUrl], projectPaths, {
          projectId: task.projectId ?? null,
          baseBranch,
          branchSuffix: Date.now().toString(36),
          createdBy: task.createdBy ?? 'system',
          taskTitle: task.title ?? '',
          taskDescription: task.description ?? '',
        });
      } catch (err) {
        fastify.log.warn({ err, taskId }, 'Single-agent QG trigger failed — skipping');
      }
    })();
  } else {
    void synthesizeAfterCompletion(fastify, {
      agentRole: role,
      success,
      summary,
      prUrl,
    });
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/routes/internal.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): trigger quality gate for single-agent task completion"
```

---

## Self-Review

**Spec coverage:**

- ✅ `triggerQualityGate()` dispatches real reviewer agent — Task 1
- ✅ Redis CRUD: `saveQgState`, `getQgState`, `deleteQgState`, `indexQgSession`, `lookupQgSession`, `removeQgSessionIndex` — Task 1
- ✅ `parseVerdictJson()` extracts `verdict_json` from TASK_COMPLETE block — Task 1
- ✅ `attempt` read from existing QG state on retry loops — Task 1
- ✅ Reviewer completion detected via `qg:session` index — Task 2
- ✅ `pass` → task "done" + log `quality_gate.passed` + chat message — Task 2
- ✅ `block` + attempt < 2 → dispatch fix agents via new WaveState (rootTaskId = taskId) — Task 2
- ✅ `block` + attempt ≥ 2 → escalate to user, log `quality_gate.escalated` — Task 2
- ✅ No valid verdict_json → treat as pass (avoid infinite loop) — Task 2
- ✅ Wave final → QG trigger when prUrls found — Task 3
- ✅ Wave final without prUrls → existing chat message behavior — Task 3
- ✅ Single-agent success + prUrl → stage stays "in_progress", QG trigger — Task 4
- ✅ Single-agent success without prUrl → synthesize (existing behavior) — Task 4
- ✅ `taskActivities` entries: `quality_gate.started`, `quality_gate.passed`, `quality_gate.blocked`, `quality_gate.escalated` — Tasks 1 + 2

**Placeholder scan:** No TBDs. All code blocks complete.

**Type consistency:**

- `QualityGateState` defined in Task 1, imported and used in Task 2 ✓
- `ReviewerVerdict` defined in Task 1, returned by `parseVerdictJson()` used in Task 2 ✓
- `triggerQualityGate()` signature in Task 1, called in Tasks 3 and 4 with same parameter shape ✓
- `WaveState` imported in `internal.ts` (already exists) — used for fix agent wave in Task 2 ✓
- `buildGitInstructions` already imported in `internal.ts` — used in fix agent prompt in Task 2 ✓
- `indexSession` already imported in `internal.ts` — used for fix agent session indexing in Task 2 ✓
- `saveWaveState` already imported in `internal.ts` — used in Task 2 ✓
- `task.createdBy` used in Task 4 — verify the `tasks` Drizzle schema has this field before running; if absent, replace with `'system'`

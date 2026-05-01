# P3 — Quality Gate Design

## Goal

Automatically dispatch a reviewer agent after every successful dev agent run. The reviewer checks out the PR branch, runs the project's test suite, and inspects the git diff. If it finds CRITICAL issues or test failures it blocks the task and dispatches fix agents. If everything passes the task moves to "done".

## Architecture

```
Dev agent completes (success + prUrl)
  → triggerQualityGate(fastify, taskId, prUrls, projectPaths, ...)
      → dispatch reviewer agent (real session — bash + Read tool)
      → save QualityGateState in Redis (qg:state:{taskId})
      → save reverse index qg:session:{reviewerSessionId} → taskId
      → log taskActivity: quality_gate.started
      → task stage stays "in_progress"

Reviewer agent completes → POST /internal/agent-complete
  → lookup qg:session:{sessionId} → taskId
  → parse verdict_json from TASK_COMPLETE block
  → verdict "pass":
      → task stage → "done"
      → log quality_gate.passed
      → push chat message
      → delete QG state
  → verdict "block":
      → log quality_gate.blocked
      → push chat message (with issues list)
      → if attempt < 2:
          → dispatch fix agents (fixRoles from verdict_json)
          → save new WaveState (rootTaskId = taskId)
          → increment attempt in QG state
      → if attempt >= 2:
          → log quality_gate.escalated
          → push chat asking user to fix manually
          → task stays "in_progress"
```

### Trigger Points (internal.ts)

Two entry points call `triggerQualityGate()`:

1. **Single-agent** (chat dispatch): agent completes with `success === true` and `prUrl` found in outputLog — replaces the current `stage → "review"` transition
2. **Wave-based** (Start with Lead): final wave completes with `rootTaskId` present — replaces the current `stage → "done"` + `wave.done` cleanup

In both cases the task does NOT move to "done" until the reviewer passes.

---

## Data Structures

### QualityGateState (Redis)

Key: `qg:state:{taskId}` — TTL 24h

```typescript
interface QualityGateState {
  taskId: string;
  reviewerSessionId: string;
  prUrls: string[]; // collected from completedSessions or single agent outputLog
  projectId: string | null;
  projectPaths: Record<string, string>;
  baseBranch: string;
  branchSuffix: string;
  createdBy: string;
  attempt: number; // starts at 0; max 2 before escalation
}
```

Reverse index: `qg:session:{sessionId}` → `taskId` — TTL 24h

### Reviewer TASK_COMPLETE output

The reviewer embeds a `verdict_json` field inside the standard TASK_COMPLETE block:

```
TASK_COMPLETE
summary: พบ CRITICAL 1 จุด (SQL injection in login route), tests: 3/5 passed
verdict_json: {"verdict":"block","fixRoles":[{"slug":"backend","brief":"Fix SQL injection in auth.ts line 42"}],"issues":[{"severity":"CRITICAL","description":"SQL injection in login route — unsanitised user input passed to raw query"}],"message":"พบปัญหา CRITICAL ที่ต้องแก้ไขก่อน task จะเสร็จ"}
END_TASK_COMPLETE
```

`verdict_json` schema:

```typescript
interface ReviewerVerdict {
  verdict: 'pass' | 'block';
  fixRoles: { slug: string; brief: string }[]; // empty when verdict is "pass"
  issues: { severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; description: string }[];
  message: string; // shown in chat
}
```

Block criteria:

- Any issue with `severity === "CRITICAL"` → block
- Any test failure (non-zero exit from test command) → block
- Only MEDIUM/LOW issues + all tests pass → pass
- No test suite found → note in summary, do not block

### taskActivities entries

All use existing `taskActivities` table (`actorId = null`):

| type                     | payload                                          | when                          |
| ------------------------ | ------------------------------------------------ | ----------------------------- |
| `quality_gate.started`   | `{ attempt, prUrls }`                            | before reviewer is dispatched |
| `quality_gate.passed`    | `{ attempt, issueCount }`                        | reviewer returns pass         |
| `quality_gate.blocked`   | `{ attempt, issues: [{severity, description}] }` | reviewer returns block        |
| `quality_gate.escalated` | `{ attempt, reason: "max_attempts_reached" }`    | attempt ≥ 2                   |

---

## Files

| File                               | Action     | Responsibility                                                                             |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `apps/api/src/lib/quality-gate.ts` | **Create** | `triggerQualityGate()`, Redis CRUD for QualityGateState + session index                    |
| `apps/api/src/routes/internal.ts`  | **Modify** | Detect reviewer session via `qg:session`, parse `verdict_json`, handle pass/block/escalate |

No schema changes — `taskActivities` table is reused as-is.

---

## quality-gate.ts

### triggerQualityGate()

```typescript
async function triggerQualityGate(
  fastify: FastifyInstance,
  taskId: string,
  prUrls: string[],
  projectPaths: Record<string, string>,
  opts: {
    projectId: string | null;
    baseBranch: string;
    branchSuffix: string;
    createdBy: string;
    attempt?: number;
    taskTitle: string;
    taskDescription: string;
  },
): Promise<void>;
```

Steps:

1. Build reviewer prompt (see below)
2. `dispatchAgent('reviewer', reviewerWorkingDir, prompt, { projectId, taskId: null, createdBy })`
3. Save `QualityGateState` to Redis
4. Save reverse index `qg:session:{sessionId}` → `taskId`
5. Insert `taskActivity: quality_gate.started`

### Reviewer prompt template

```
You are a code reviewer. Your job is to check a completed task before it is marked done.

Task: {title}
Description: {description}

PRs to review:
{prUrls.map(url => `- ${url}`).join('\n')}

For each PR:
1. gh pr checkout {prNumber}
2. git diff origin/{baseBranch}...HEAD — inspect all changes
3. Review for: OWASP Top 10 security issues, logic correctness, edge cases, code quality
4. Discover and run the test suite:
   - Check package.json scripts for "test" → npm test
   - Check for pytest.ini / pyproject.toml → pytest
   - Check for vitest.config / jest.config → npx vitest run / npx jest
   - If no test suite found: note it, do not block

Block if: any CRITICAL security or logic issue found, OR any test command exits non-zero.
Pass if: no CRITICAL issues and all tests pass (or no test suite exists).

Output exactly this TASK_COMPLETE block — no other text after it:
TASK_COMPLETE
summary: <1-2 sentences>
verdict_json: {"verdict":"pass"|"block","fixRoles":[{"slug":"<role>","brief":"<what to fix>"}],"issues":[{"severity":"CRITICAL|HIGH|MEDIUM|LOW","description":"<detail>"}],"message":"<shown in chat to user>"}
END_TASK_COMPLETE
```

### Redis helpers

```typescript
saveQgState(redis, state: QualityGateState): Promise<void>
getQgState(redis, taskId: string): Promise<QualityGateState | null>
deleteQgState(redis, taskId: string): Promise<void>
indexQgSession(redis, sessionId: string, taskId: string): Promise<void>
lookupQgSession(redis, sessionId: string): Promise<string | null>   // returns taskId
removeQgSessionIndex(redis, sessionId: string): Promise<void>
```

---

## internal.ts — Quality Gate Handler

In the `agent-complete` handler, after existing wave-session lookup, add:

```
1. lookupQgSession(redis, sessionId)
   → if found (taskId returned):
       a. Parse TASK_COMPLETE block for verdict_json
       b. removeQgSessionIndex
       c. getQgState → QualityGateState
       d. if verdict === "pass":
            - update task stage → "done"
            - logTaskActivity: quality_gate.passed
            - pushChatMessage (evalResult.message)
            - deleteQgState
       e. if verdict === "block":
            - logTaskActivity: quality_gate.blocked
            - pushChatMessage
            - if state.attempt < 2:
                - dispatch fix agents (fixRoles from verdict)
                - save WaveState (rootTaskId = taskId, waves = [{roles: fixRoles, brief: "Fix issues found by quality gate"}])
                - update QgState: attempt + 1, new reviewerSessionId = null (will be set after next wave)
            - if state.attempt >= 2:
                - logTaskActivity: quality_gate.escalated
                - pushChatMessage asking user to fix manually
                - deleteQgState
       f. set handledByQG = true (skip regular wave/synthesis logic)
   → if not found: continue to existing wave/single-agent logic
```

### Trigger in wave final completion

Replace current `wave.done` + stage change with:

```typescript
if (state.rootTaskId) {
  const prUrls = state.completedSessions
    .map((s) => s.summary.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0])
    .filter(Boolean) as string[];
  await triggerQualityGate(fastify, state.rootTaskId, prUrls, projectPaths, {
    projectId: state.projectId,
    baseBranch: state.baseBranch,
    branchSuffix: state.branchSuffix,
    createdBy: state.createdBy,
    taskTitle: state.taskTitle,
    taskDescription: state.taskDescription,
  });
  await deleteWaveState(fastify.redis, proposalId);
} else {
  // no rootTaskId — existing behavior (push chat msg, cleanup)
}
```

### Trigger in single-agent completion

Replace `stage → "review"` with `triggerQualityGate()` when `success && prUrl`.

---

## Spec Self-Review

1. **Placeholder scan:** No TBDs. Reviewer prompt is complete. All Redis keys defined.
2. **Internal consistency:** `attempt` starts at 0, escalates at ≥ 2 (so 3 total attempts: 0, 1, 2 before escalation — correct). `handledByQG` flag prevents double-processing. Wave-final trigger deletes WaveState before returning — no conflict with wave handler.
3. **Scope check:** Single spec, implementable in two files. No schema changes.
4. **Ambiguity:** "Pass if no test suite found" is explicit. "Block on any CRITICAL" is explicit. Fix agent dispatch reuses existing WaveState + wave progression — reviewer re-fires automatically after fix agents complete (via wave.done trigger). This is correct and intentional.

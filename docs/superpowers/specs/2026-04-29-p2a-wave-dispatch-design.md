# P2a — Wave-Based Dispatch Design

## Goal

Enable Lead to dispatch agents in sequential waves, where agents within the same wave run in parallel and subsequent waves auto-trigger after Lead evaluates the previous wave's results.

## Architecture

### Flow

```
User confirm proposal
  → dispatch Wave 0 agents (all roles in wave 0, parallel)
  → save wave:state:{proposalId} in Redis

Each agent completes → POST /internal/agent-complete
  → update wave state (add to completedSessions)
  → if all pendingSessions in current wave done:
      → runWaveEvaluation() → Lead LLM decides
          → proceed: true  → dispatch next wave + push chat msg
          → proceed: false, ask: true → push chat msg asking user
      → if last wave: cleanup wave state
```

### New Files

- `apps/api/src/lib/lead-wave.ts` — `runWaveEvaluation()`
- `apps/api/src/lib/wave-store.ts` — Redis CRUD for wave state

### Modified Files

- `apps/api/src/lib/lead.ts` — `waves[]` in LeadDecision schema + system prompt update
- `apps/api/src/routes/chat.ts` — store waves in proposal, dispatch wave 0, save wave state
- `apps/api/src/routes/internal.ts` — wave completion detection + next-wave trigger
- `apps/web/components/layout/CommandBar.tsx` — proposal card shows waves instead of flat roles

---

## Data Structures

### LeadDecision (updated)

```typescript
interface LeadWave {
  roles: { slug: string; reason?: string }[];
  brief: string; // what this wave should accomplish
}

interface LeadDecision {
  intent: 'chat' | 'clarify' | 'dispatch';
  reply: string;
  waves?: LeadWave[]; // replaces roles[]
  taskBrief?: { title: string; description: string };
  questions?: string[];
}
```

Lead JSON output for dispatch intent:

```json
{
  "intent": "dispatch",
  "reply": "...",
  "taskBrief": { "title": "...", "description": "..." },
  "waves": [
    { "roles": [{ "slug": "backend", "reason": "..." }], "brief": "Build REST endpoints" },
    { "roles": [{ "slug": "frontend" }, { "slug": "mobile" }], "brief": "Integrate with API" }
  ]
}
```

Roles within one wave run in parallel. Waves are sequential.

### StoredProposal (updated)

Add `waves: LeadWave[]`. Keep `roles` as `waves[0].roles` flattened for backward compat with existing UI paths that haven't migrated yet.

### Redis Wave State

Key: `wave:state:{proposalId}` — TTL 24h

```typescript
interface WaveState {
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
  pendingSessions: string[]; // sessionIds currently running in this wave
  completedSessions: Array<{
    sessionId: string;
    role: string;
    success: boolean;
    summary: string;
    exitCode: number | null;
  }>;
}
```

Wave is complete when every sessionId in `pendingSessions` appears in `completedSessions`.

---

## Wave Evaluation

`runWaveEvaluation(state: WaveState): Promise<WaveEvalResult>`

Located in `lib/lead-wave.ts`. Calls the same orchestrator `/prompt` endpoint Lead uses.

### Input prompt (short, focused)

```
Wave {N} completed for task: {taskTitle}

Results:
- {role} (success): {summary} — PR: {prUrl | none}
- {role} (FAILED): {summary}

Next wave ({N+1}): {wave.brief}
Roles: {roles}

Should we proceed automatically, or is there an issue that needs the user's attention?
Respond with JSON only: { "proceed": true|false, "ask": true|false, "message": "..." }
```

### Output

```typescript
interface WaveEvalResult {
  proceed: boolean;
  ask: boolean; // true = push question to user before acting
  message: string; // shown in chat
}
```

Rules:

- All wave success → `proceed: true, ask: false`
- Partial failure → Lead decides; if confident → `proceed: true` (or false + message); if unsure → `ask: true`
- All failed → `proceed: false, ask: true`

---

## Task Creation

Task creation stays lazy (Option A): each task is created with its `agentRole` at the moment its wave dispatches. No upfront task tree. No schema changes to the `tasks` table.

---

## Wave Dispatch Logic (chat.ts — POST /chat/dispatch)

```
1. Build projectPaths once (existing P1 fix)
2. Build fullPrompt once
3. Dispatch all roles in waves[0] → collect sessionIds → pendingSessions
4. Store wave:state:{proposalId} in Redis
5. Return dispatched messages as before
```

If proposal has no `waves` (old proposal format): fall back to dispatching `roles` directly, no wave state saved.

---

## Agent Complete Handler (internal.ts — POST /internal/agent-complete)

```
1. Existing logic: update task stage, save outputLog, etc.
2. NEW: look up wave:state by sessionId
   - If not found: single-wave dispatch, nothing to do
   - Move sessionId from pendingSessions → completedSessions
   - If pendingSessions still has remaining ids: return (wait)
   - If pendingSessions empty (wave done):
       a. runWaveEvaluation(state)
       b. if proceed && nextWave exists: dispatch nextWave, update state, push chat msg
       c. if ask: push chat question msg to user (via chat channel)
       d. if last wave or no proceed: cleanup wave:state key
```

Finding wave state by sessionId requires a secondary index or scanning (see implementation note below).

### Implementation Note — sessionId lookup

Store a reverse index: `wave:session:{sessionId} → proposalId` (TTL 24h) when each session is dispatched. `agent-complete` does: `GET wave:session:{sessionId}` → get proposalId → `GET wave:state:{proposalId}`.

---

## UI — Proposal Card (CommandBar.tsx)

When `proposal.waves` exists, render waves instead of flat roles:

```
Wave 1  [backend]              Build REST endpoints for auth
Wave 2  [frontend] [mobile]    Integrate login UI with new API
Wave 3  [qa]                   Run integration tests
```

When `proposal.waves` is absent (old format): render existing flat role list unchanged.

---

## Spec Self-Review

- No TBDs or placeholders remain.
- `roles` backward compat is explicit — old proposals without `waves` fall back gracefully.
- `wave:session:{sessionId}` reverse index prevents O(n) scan on agent-complete.
- Task creation is lazy (no schema change needed).
- Wave evaluation prompt is short and focused — won't confuse Lead LLM.
- UI change is additive — old proposals unaffected.
- No contradictions between sections found.

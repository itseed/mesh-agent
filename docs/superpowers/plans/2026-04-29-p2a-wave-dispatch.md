# P2a — Wave-Based Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Lead to dispatch agents in sequential waves, where roles within a wave run in parallel and subsequent waves auto-trigger after Lead evaluates the previous wave's output.

**Architecture:** `StoredProposal` gains a `waves[]` field. On user confirm, Wave 0 dispatches immediately and a `wave:state:{proposalId}` Redis key tracks progress. When all sessions in a wave report to `/internal/agent-complete`, `runWaveEvaluation()` asks Lead LLM to auto-proceed or ask the user. Backward compat: proposals without `waves` fall back to existing flat `roles[]` behavior.

**Tech Stack:** Fastify, Drizzle ORM, ioredis, TypeScript, Next.js (React)

---

## File Map

| File                                        | Action     | Responsibility                                                                                                                                     |
| ------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/wave-store.ts`            | **Create** | Redis CRUD for WaveState + session→proposalId reverse index                                                                                        |
| `apps/api/src/lib/lead-wave.ts`             | **Create** | `runWaveEvaluation()` — Lead LLM decides proceed/ask                                                                                               |
| `apps/api/src/lib/lead.ts`                  | **Modify** | Import `LeadWave` from wave-store; add `waves[]` to `LeadDecision`; update system prompt and `sanitizeDecision`                                    |
| `apps/api/src/routes/chat.ts`               | **Modify** | Add `waves` to `StoredProposal`; dispatch wave 0 on confirm; save wave state                                                                       |
| `apps/api/src/routes/internal.ts`           | **Modify** | Add wave progression after agent-complete: detect wave done, evaluate, trigger next wave or ask user; skip per-agent synthesis for mid-wave agents |
| `apps/web/components/layout/CommandBar.tsx` | **Modify** | Render waves breakdown in proposal card when `proposal.waves` exists                                                                               |

---

### Task 1: Create wave-store.ts

**Files:**

- Create: `apps/api/src/lib/wave-store.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/lib/wave-store.ts
import type { Redis } from 'ioredis';

export interface WaveRole {
  slug: string;
  reason?: string;
}

export interface LeadWave {
  roles: WaveRole[];
  brief: string;
}

export interface WaveCompletedSession {
  sessionId: string;
  role: string;
  success: boolean;
  summary: string;
  exitCode: number | null;
}

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
}

const WAVE_TTL = 86400; // 24 h

export const waveStateKey = (id: string) => `wave:state:${id}`;
export const sessionIndexKey = (id: string) => `wave:session:${id}`;

export async function saveWaveState(redis: Redis, state: WaveState): Promise<void> {
  await redis.set(waveStateKey(state.proposalId), JSON.stringify(state), 'EX', WAVE_TTL);
}

export async function getWaveState(redis: Redis, proposalId: string): Promise<WaveState | null> {
  const raw = await redis.get(waveStateKey(proposalId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WaveState;
  } catch {
    return null;
  }
}

export async function updateWaveState(redis: Redis, state: WaveState): Promise<void> {
  // KEEPTTL preserves remaining TTL without resetting the 24 h window
  await redis.set(waveStateKey(state.proposalId), JSON.stringify(state), 'KEEPTTL');
}

export async function deleteWaveState(redis: Redis, proposalId: string): Promise<void> {
  await redis.del(waveStateKey(proposalId));
}

export async function indexSession(
  redis: Redis,
  sessionId: string,
  proposalId: string,
): Promise<void> {
  await redis.set(sessionIndexKey(sessionId), proposalId, 'EX', WAVE_TTL);
}

export async function lookupSessionProposal(
  redis: Redis,
  sessionId: string,
): Promise<string | null> {
  return redis.get(sessionIndexKey(sessionId));
}

export async function removeSessionIndex(redis: Redis, sessionId: string): Promise<void> {
  await redis.del(sessionIndexKey(sessionId));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kriangkrai/project/mesh-agent
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/wave-store.ts
git commit -m "feat(api): add wave state Redis store"
```

---

### Task 2: Create lead-wave.ts

**Files:**

- Create: `apps/api/src/lib/lead-wave.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/lib/lead-wave.ts
import type { WaveState } from './wave-store.js';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4802';

export interface WaveEvalResult {
  proceed: boolean;
  ask: boolean;
  message: string;
}

async function callOrchestrator(prompt: string): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeoutMs: 30_000 }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Orchestrator error ${res.status}: ${body.error ?? 'unknown'}`);
  }
  const { stdout } = (await res.json()) as { stdout: string };
  return stdout;
}

function buildPrompt(state: WaveState): string {
  const nextWave = state.waves[state.currentWave + 1];
  const results = state.completedSessions
    .map((s) => `- ${s.role} (${s.success ? 'success' : 'FAILED'}): ${s.summary}`)
    .join('\n');
  const nextDesc = nextWave
    ? `Next wave (${state.currentWave + 1}): "${nextWave.brief}" — Roles: ${nextWave.roles.map((r) => r.slug).join(', ')}`
    : 'This was the final wave.';

  return [
    `You are the Lead of a software development team. Wave ${state.currentWave} has just completed for task: "${state.taskTitle}"`,
    '',
    'Wave results:',
    results || '(no results recorded)',
    '',
    nextDesc,
    '',
    nextWave
      ? 'Decide: should we auto-proceed to the next wave, or does the user need to be consulted first?'
      : 'All waves are complete. Write a brief completion summary for the user.',
    '',
    'Rules:',
    '- All agents succeeded + next wave exists → { "proceed": true, "ask": false, "message": "..." }',
    '- Partial failure but clearly safe to continue → { "proceed": true, "ask": false, "message": "note the issue, still proceeding" }',
    '- Significant failure or ambiguous outcome → { "proceed": false, "ask": true, "message": "describe the problem and ask what to do" }',
    '- Final wave complete (no next wave) → { "proceed": false, "ask": false, "message": "completion summary" }',
    '- Reply in the same language the task title uses (Thai or English).',
    '',
    'Respond with valid JSON only — no markdown, no commentary:',
    '{ "proceed": true|false, "ask": true|false, "message": "<your message to the user>" }',
  ].join('\n');
}

function parseResult(stdout: string): WaveEvalResult {
  let text = stdout.trim();
  try {
    const w = JSON.parse(text);
    if (typeof w.result === 'string') text = w.result.trim();
    else if (typeof w.stdout === 'string') text = w.stdout.trim();
  } catch {
    /* not the wrapper format */
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Wave eval returned no JSON. Raw: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    proceed: parsed.proceed === true,
    ask: parsed.ask === true,
    message:
      typeof parsed.message === 'string' ? parsed.message.trim() : 'Wave evaluation complete.',
  };
}

export async function runWaveEvaluation(state: WaveState): Promise<WaveEvalResult> {
  const stdout = await callOrchestrator(buildPrompt(state));
  return parseResult(stdout);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kriangkrai/project/mesh-agent
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/lead-wave.ts
git commit -m "feat(api): add wave evaluation LLM helper"
```

---

### Task 3: Update lead.ts — waves[] in schema

**Files:**

- Modify: `apps/api/src/lib/lead.ts`

- [ ] **Step 1: Import LeadWave from wave-store and update LeadDecision**

At the top of `apps/api/src/lib/lead.ts`, add the import (after `import { readFileSync } ...`):

```typescript
import type { LeadWave } from './wave-store.js';
```

Find the `LeadDecision` interface and replace it with:

```typescript
export interface LeadDecision {
  intent: LeadIntent;
  reply: string;
  waves?: LeadWave[];
  roles?: LeadProposalRole[]; // backward compat — set to waves[0].roles on parse
  taskBrief?: {
    title: string;
    description: string;
  };
  questions?: string[];
}
```

- [ ] **Step 2: Replace DEFAULT_LEAD_SYSTEM_PROMPT**

Replace the entire `DEFAULT_LEAD_SYSTEM_PROMPT` constant:

```typescript
const DEFAULT_LEAD_SYSTEM_PROMPT = `You are the Lead of a software development team using the MeshAgent platform. The user talks to you via a chat box. You manage a team of specialist agents (frontend, backend, mobile, devops, designer, qa, reviewer).

Your job is to behave like a real tech lead during a stand-up:
- If the user is asking a question, chatting, or thinking out loud → just talk back. Do not create work.
- If the user's request is ambiguous, missing scope, or could be interpreted multiple ways → ask clarifying questions before committing to work.
- Only when the request is concrete and ready to execute, propose a task brief plus waves of work. Do NOT execute it yet — the user must confirm.

You always reply in the same language the user used (Thai → Thai, English → English).

Output ONLY one valid JSON object — no markdown, no commentary, no extra text — with this schema:

{
  "intent": "chat" | "clarify" | "dispatch",
  "reply": "<your message to the user, conversational tone, in their language>",
  "waves": [
    { "roles": [{ "slug": "frontend|backend|mobile|devops|designer|qa|reviewer", "reason": "..." }], "brief": "<what this wave accomplishes>" }
  ],
  "taskBrief": { "title": "<short, <=80 chars>", "description": "<full task description for the agents>" },
  "questions": ["<clarifying question>", ...]
}

Rules:
- "chat": user is asking a question, greeting, or discussing — reply only, omit waves/taskBrief/questions.
- "clarify": you need more info — set "questions" with 1–3 specific questions; omit waves/taskBrief.
- "dispatch": ready to assign work — fill "waves" and "taskBrief". The "reply" should briefly summarize the plan and ask the user to confirm. Do NOT promise that work has started.
- Waves are sequential: Wave 0 dispatches immediately on confirm, Wave 1 starts only after Wave 0 finishes, etc.
- Roles within the same wave run in parallel — only put roles in the same wave when they can truly work independently without conflicts.
- Strongly prefer a single wave with one role. Only add a second wave when there is a clear sequential dependency (e.g. backend API must exist before frontend can integrate it).
- Never invent role slugs outside the allowed list.
- Don't add a reviewer or qa unless the user asked for review/testing or the change is risky.
- Keep "reply" concise (a few sentences max).`;
```

- [ ] **Step 3: Update sanitizeDecision — parse waves, fallback to roles[]**

In `sanitizeDecision`, find the `if (intent === 'dispatch')` block and replace it entirely:

```typescript
if (intent === 'dispatch') {
  const ALLOWED = ALLOWED_ROLES;

  // Helper: parse a raw roles array into LeadProposalRole[]
  function parseRoles(raw: unknown[]): LeadProposalRole[] {
    const out: LeadProposalRole[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const slug = String((r as Record<string, unknown>).slug ?? '').toLowerCase();
      if (!ALLOWED.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      const reason = (r as Record<string, unknown>).reason;
      out.push({ slug, reason: typeof reason === 'string' ? reason : undefined });
    }
    return out;
  }

  // Parse waves[] (new format)
  const wavesRaw = Array.isArray(obj.waves) ? obj.waves : [];
  const waves: LeadWave[] = [];
  for (const w of wavesRaw) {
    if (!w || typeof w !== 'object') continue;
    const wObj = w as Record<string, unknown>;
    const waveRoles = parseRoles(Array.isArray(wObj.roles) ? wObj.roles : []);
    if (waveRoles.length === 0) continue;
    const brief = typeof wObj.brief === 'string' ? wObj.brief.trim() : '';
    waves.push({ roles: waveRoles, brief });
  }

  // Fallback: Lead sent old-style roles[] — wrap into single wave
  if (waves.length === 0) {
    const fallback = parseRoles(Array.isArray(obj.roles) ? obj.roles : []);
    if (fallback.length > 0) waves.push({ roles: fallback, brief: '' });
  }

  if (waves.length === 0) {
    throw new Error('Lead chose dispatch but returned no valid waves or roles');
  }

  decision.waves = waves.slice(0, 6);
  decision.roles = waves[0].roles; // backward compat for UI paths not yet wave-aware

  const briefRaw = obj.taskBrief;
  if (!briefRaw || typeof briefRaw !== 'object') {
    throw new Error('Lead chose dispatch but taskBrief missing');
  }
  const brief = briefRaw as Record<string, unknown>;
  const title = typeof brief.title === 'string' ? brief.title.trim().slice(0, 80) : '';
  const description = typeof brief.description === 'string' ? brief.description.trim() : '';
  if (!title || !description) throw new Error('Lead taskBrief missing title or description');
  decision.taskBrief = { title, description };
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kriangkrai/project/mesh-agent
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/lead.ts
git commit -m "feat(api): add waves[] to Lead decision schema with backward compat"
```

---

### Task 4: Update chat.ts — store waves, dispatch wave 0

**Files:**

- Modify: `apps/api/src/routes/chat.ts`

- [ ] **Step 1: Add imports**

After the existing imports in `apps/api/src/routes/chat.ts`, add:

```typescript
import { saveWaveState, indexSession, type LeadWave, type WaveState } from '../lib/wave-store.js';
```

- [ ] **Step 2: Add `waves` to StoredProposal interface**

Find the `StoredProposal` interface and add the `waves` field:

```typescript
interface StoredProposal {
  id: string;
  createdAt: number;
  status: ProposalStatus;
  userMessage: string;
  imageNote: string;
  imagePaths: string[];
  projectId: string | null;
  workingDir: string;
  baseBranch: string;
  roles: { slug: string; reason?: string }[];
  waves: LeadWave[]; // NEW
  taskBrief: { title: string; description: string };
}
```

- [ ] **Step 3: Set waves when creating proposal in POST /chat**

In the `if (decision.intent === 'dispatch' && decision.taskBrief && decision.roles)` block, add `waves` to the proposal:

```typescript
const proposal: StoredProposal = {
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  status: 'pending',
  userMessage: body.message,
  imageNote,
  imagePaths,
  projectId: ctx.projectId,
  workingDir: ctx.workingDir,
  baseBranch: ctx.baseBranch,
  roles: decision.roles ?? [],
  waves: decision.waves ?? [], // NEW
  taskBrief: decision.taskBrief,
};
```

- [ ] **Step 4: Replace dispatch loop in POST /chat/dispatch to dispatch wave 0 and save wave state**

In the `POST /chat/dispatch` handler, find the `const dispatched: ChatMessage[] = []` line and the entire `for (const r of proposal.roles)` loop. Replace everything from `const dispatched` to `return { confirm: confirmMsg, dispatches: dispatched }` with:

```typescript
// Wave 0 roles — or fall back to flat roles for old proposals
const wave0Roles = proposal.waves.length > 0 ? proposal.waves[0].roles : proposal.roles;

const pendingSessions: string[] = [];
const dispatched: ChatMessage[] = [];

for (const r of wave0Roles) {
  const role = await findRoleBySlug(fastify, r.slug);
  if (!role) {
    fastify.log.warn({ slug: r.slug }, 'Skipping unknown role from proposal');
    continue;
  }

  const agentWorkingDir =
    projectPaths[r.slug] ?? Object.values(projectPaths)[0] ?? proposal.workingDir;

  const [task] = await fastify.db
    .insert(tasks)
    .values({
      title: proposal.taskBrief.title,
      description: proposal.taskBrief.description,
      stage: 'in_progress',
      agentRole: r.slug,
      projectId: proposal.projectId ?? null,
    })
    .returning();

  if (task?.id) {
    await fastify.redis.publish(
      'tasks:events',
      JSON.stringify({
        type: 'task.created',
        taskId: task.id,
        projectId: proposal.projectId ?? null,
      }),
    );
  }

  const result = await dispatchAgent(
    r.slug,
    agentWorkingDir,
    fullPrompt,
    {
      projectId: proposal.projectId ?? null,
      taskId: task?.id ?? null,
      createdBy: userId,
    },
    role?.systemPrompt ?? undefined,
  );

  if (!result.id && task?.id) {
    await fastify.db
      .update(tasks)
      .set({ stage: 'backlog', status: 'blocked', updatedAt: new Date() })
      .where(eq(tasks.id, task.id));
  }

  if (result.id) {
    pendingSessions.push(result.id);
    await indexSession(fastify.redis, result.id, proposal.id);
  }

  const waveLabel = proposal.waves.length > 1 ? 'Wave 1' : '';
  const agentMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'agent',
    content: result.id
      ? `[${r.slug}]${waveLabel ? ` ${waveLabel}` : ''} เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`
      : `[${r.slug}] ยังไม่สามารถเริ่ม session ได้ — ${result.error ?? 'orchestrator ไม่ตอบ'} (task ถูก mark blocked)`,
    timestamp: Date.now(),
    meta: { agentRole: r.slug, sessionId: result.id ?? undefined, taskId: task?.id },
  };
  await pushHistory(fastify, agentMsg);
  dispatched.push(agentMsg);
}

// Save wave state only when there are multiple waves and at least one session started
if (proposal.waves.length > 1 && pendingSessions.length > 0) {
  const waveState: WaveState = {
    proposalId: proposal.id,
    waves: proposal.waves,
    currentWave: 0,
    taskTitle: proposal.taskBrief.title,
    taskDescription: proposal.taskBrief.description,
    projectId: proposal.projectId,
    baseBranch: proposal.baseBranch,
    branchSuffix,
    createdBy: userId,
    imagePaths: proposal.imagePaths ?? [],
    pendingSessions,
    completedSessions: [],
  };
  await saveWaveState(fastify.redis, waveState);
}

return { confirm: confirmMsg, dispatches: dispatched };
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/kriangkrai/project/mesh-agent
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/chat.ts
git commit -m "feat(api): dispatch wave 0 on confirm and save wave state"
```

---

### Task 5: Update internal.ts — wave progression on agent-complete

**Files:**

- Modify: `apps/api/src/routes/internal.ts`

- [ ] **Step 1: Add imports**

After the existing imports in `apps/api/src/routes/internal.ts`, add:

```typescript
import {
  lookupSessionProposal,
  getWaveState,
  updateWaveState,
  deleteWaveState,
  removeSessionIndex,
  indexSession,
  type WaveState,
} from '../lib/wave-store.js';
import { runWaveEvaluation } from '../lib/lead-wave.js';
import { dispatchAgent, buildGitInstructions } from '../lib/dispatch.js';
import { findRoleBySlug } from '../lib/roles.js';
import { projects } from '@meshagent/shared';
```

(The `tasks`, `eq`, `FastifyInstance` imports already exist — do not duplicate them.)

- [ ] **Step 2: Add dispatchNextWave helper before internalRoutes function**

Add this function in `internal.ts`, before `export async function internalRoutes(...)`:

```typescript
async function dispatchNextWave(
  fastify: FastifyInstance,
  state: WaveState,
  waveIndex: number,
): Promise<string[]> {
  const wave = state.waves[waveIndex];
  if (!wave) return [];

  let projectPaths: Record<string, string> = {};
  if (state.projectId) {
    const [proj] = await fastify.db
      .select()
      .from(projects)
      .where(eq(projects.id, state.projectId))
      .limit(1);
    if (proj) projectPaths = (proj.paths as Record<string, string>) ?? {};
  }

  // Inject previous wave summaries so agents have artifact context
  const prevSummary = state.completedSessions
    .map((s) => `[${s.role}] ${s.success ? '✓' : '✗'}: ${s.summary}`)
    .join('\n');
  const contextBlock = prevSummary
    ? `\n\n## ผลงานจาก Wave ก่อนหน้า\n${prevSummary}\n\n## คำสั่งปัจจุบัน`
    : '';

  const imageBlock =
    state.imagePaths.length > 0
      ? `\n\n## Attached images\n${state.imagePaths.map((p) => `- ${p}`).join('\n')}`
      : '';

  const gitInstructions = buildGitInstructions(state.baseBranch, state.branchSuffix);
  const fullPrompt = `${contextBlock}\n${state.taskDescription}${imageBlock}${gitInstructions}`;

  const pendingSessions: string[] = [];

  for (const r of wave.roles) {
    const role = await findRoleBySlug(fastify, r.slug);
    if (!role) {
      fastify.log.warn({ slug: r.slug }, 'dispatchNextWave: skipping unknown role');
      continue;
    }

    const agentWorkingDir = projectPaths[r.slug] ?? Object.values(projectPaths)[0] ?? '/tmp';

    const [task] = await fastify.db
      .insert(tasks)
      .values({
        title: state.taskTitle,
        description: state.taskDescription,
        stage: 'in_progress',
        agentRole: r.slug,
        projectId: state.projectId ?? null,
      })
      .returning();

    if (task?.id) {
      await fastify.redis.publish(
        TASKS_CHANNEL,
        JSON.stringify({
          type: 'task.created',
          taskId: task.id,
          projectId: state.projectId ?? null,
        }),
      );
    }

    const result = await dispatchAgent(
      r.slug,
      agentWorkingDir,
      fullPrompt,
      {
        projectId: state.projectId ?? null,
        taskId: task?.id ?? null,
        createdBy: state.createdBy,
      },
      role?.systemPrompt ?? undefined,
    );

    if (!result.id && task?.id) {
      await fastify.db
        .update(tasks)
        .set({ stage: 'backlog', status: 'blocked', updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
    }

    if (result.id) {
      pendingSessions.push(result.id);
      await indexSession(fastify.redis, result.id, state.proposalId);
    }

    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'agent' as const,
      content: result.id
        ? `[${r.slug}] Wave ${waveIndex} เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`
        : `[${r.slug}] ไม่สามารถเริ่ม session ได้ — ${result.error ?? 'orchestrator ไม่ตอบ'}`,
      timestamp: Date.now(),
      meta: { agentRole: r.slug, sessionId: result.id ?? undefined },
    });
  }

  return pendingSessions;
}
```

- [ ] **Step 3: Add wave progression in agent-complete handler**

In the `POST /internal/agent-complete` handler, find the line `void synthesizeAfterCompletion(...)`. Replace that entire `void synthesizeAfterCompletion(...)` call with:

```typescript
// Wave progression — if this session belongs to a wave, handle the wave logic.
// Otherwise fall through to the normal single-agent synthesis.
let handledByWave = false;
try {
  const proposalId = await lookupSessionProposal(fastify.redis, body.sessionId);
  if (proposalId) {
    handledByWave = true;
    await removeSessionIndex(fastify.redis, body.sessionId);
    const state = await getWaveState(fastify.redis, proposalId);
    if (state) {
      state.completedSessions.push({
        sessionId: body.sessionId,
        role,
        success,
        summary,
        exitCode: body.exitCode ?? null,
      });
      state.pendingSessions = state.pendingSessions.filter((id) => id !== body.sessionId);

      if (state.pendingSessions.length > 0) {
        // Still waiting for other agents in this wave — just persist updated state
        await updateWaveState(fastify.redis, state);
      } else {
        // All agents in current wave done — evaluate
        const hasNextWave = state.currentWave + 1 < state.waves.length;
        const evalResult = await runWaveEvaluation(state);

        if (!hasNextWave) {
          // Final wave complete
          await pushChatMessage(fastify, {
            id: crypto.randomUUID(),
            role: 'lead' as const,
            content: evalResult.message,
            timestamp: Date.now(),
          });
          await deleteWaveState(fastify.redis, proposalId);
        } else if (evalResult.ask) {
          // Lead unsure — surface to user, stop auto-progression
          await pushChatMessage(fastify, {
            id: crypto.randomUUID(),
            role: 'lead' as const,
            content: evalResult.message,
            timestamp: Date.now(),
          });
          await deleteWaveState(fastify.redis, proposalId);
        } else if (evalResult.proceed) {
          // Auto-proceed: push status message then dispatch next wave
          await pushChatMessage(fastify, {
            id: crypto.randomUUID(),
            role: 'lead' as const,
            content: evalResult.message,
            timestamp: Date.now(),
          });
          const nextWaveIndex = state.currentWave + 1;
          const newPending = await dispatchNextWave(fastify, state, nextWaveIndex);
          state.currentWave = nextWaveIndex;
          state.pendingSessions = newPending;
          state.completedSessions = []; // fresh slate for next wave
          if (newPending.length > 0) {
            await updateWaveState(fastify.redis, state);
          } else {
            await deleteWaveState(fastify.redis, proposalId);
          }
        } else {
          // proceed: false, ask: false — treat as done
          await pushChatMessage(fastify, {
            id: crypto.randomUUID(),
            role: 'lead' as const,
            content: evalResult.message,
            timestamp: Date.now(),
          });
          await deleteWaveState(fastify.redis, proposalId);
        }
      }
    }
  }
} catch (err) {
  fastify.log.warn(
    { err, sessionId: body.sessionId },
    'Wave progression failed — falling through to synthesis',
  );
  handledByWave = false;
}

// Single-agent synthesis only when not part of a wave
if (!handledByWave) {
  void synthesizeAfterCompletion(fastify, { agentRole: role, success, summary, prUrl });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kriangkrai/project/mesh-agent
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/internal.ts
git commit -m "feat(api): add wave progression on agent-complete"
```

---

### Task 6: Update CommandBar.tsx — wave display in proposal card

**Files:**

- Modify: `apps/web/components/layout/CommandBar.tsx`

- [ ] **Step 1: Add waves to ProposalView interface**

Find the `ProposalView` interface and add `waves`:

```typescript
interface ProposalView {
  id: string;
  status: ProposalStatus;
  taskBrief: { title: string; description: string };
  roles: { slug: string; reason?: string }[];
  waves?: { roles: { slug: string; reason?: string }[]; brief: string }[]; // NEW
  projectId: string | null;
  baseBranch: string;
}
```

- [ ] **Step 2: Replace roles rendering in proposal card with wave-aware renderer**

Search for where `proposal.roles.map` is used in the JSX (inside the proposal card rendering). Replace that entire roles rendering section with:

```tsx
{
  proposal.waves && proposal.waves.length > 1 ? (
    <div className="flex flex-col gap-1.5 mt-2">
      {proposal.waves.map((wave, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-[11px] text-dim w-14 shrink-0 pt-0.5">Wave {i + 1}</span>
          <div className="flex flex-col gap-0.5">
            <div className="flex gap-1 flex-wrap">
              {wave.roles.map((r) => (
                <span
                  key={r.slug}
                  className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                  style={{
                    backgroundColor: `${ROLE_DOT[r.slug] ?? '#888'}22`,
                    color: ROLE_DOT[r.slug] ?? '#888',
                  }}
                >
                  {r.slug}
                </span>
              ))}
            </div>
            {wave.brief && <span className="text-[11px] text-dim">{wave.brief}</span>}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="flex gap-1 flex-wrap mt-1">
      {proposal.roles.map((r) => (
        <span
          key={r.slug}
          className="px-1.5 py-0.5 rounded text-[12px] font-medium"
          style={{
            backgroundColor: `${ROLE_DOT[r.slug] ?? '#888'}22`,
            color: ROLE_DOT[r.slug] ?? '#888',
          }}
        >
          {r.slug}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/kriangkrai/project/mesh-agent
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/layout/CommandBar.tsx
git commit -m "feat(web): show wave breakdown in proposal card"
```

---

## Self-Review

**Spec coverage:**

- ✅ `waves[]` in LeadDecision + system prompt — Task 3
- ✅ `StoredProposal.waves` — Task 4
- ✅ Wave 0 dispatch on confirm + wave state saved — Task 4
- ✅ `wave:state:{proposalId}` Redis CRUD — Task 1
- ✅ `wave:session:{sessionId}` reverse index — Task 1
- ✅ Agent-complete: detect wave done, evaluate, auto-proceed or ask — Task 5
- ✅ `runWaveEvaluation()` — Task 2
- ✅ `dispatchNextWave()` injects previous wave summaries as artifact context — Task 5
- ✅ Backward compat: old proposals (no `waves`) fall back to `roles[]` — Task 3 + Task 4
- ✅ Skip per-agent synthesis for wave agents; fire it only for non-wave agents — Task 5
- ✅ UI: proposal card shows waves when `waves.length > 1` — Task 6
- ✅ Task creation stays lazy (created per wave at dispatch time) — Task 4 + Task 5

**Placeholder scan:** No TBDs, no vague steps. All code blocks contain complete implementations.

**Type consistency:**

- `LeadWave` defined once in `wave-store.ts`; imported by `lead.ts`, `chat.ts`, `internal.ts` — no duplication.
- `WaveState.completedSessions` cleared to `[]` when advancing to next wave (Task 5 Step 3) — correct, fresh slate per wave.
- `buildGitInstructions` imported in both `chat.ts` (already) and `internal.ts` (Task 5 Step 1) — no conflict.
- `projects` table imported in `internal.ts` (Task 5 Step 1) for projectPaths lookup in `dispatchNextWave`.

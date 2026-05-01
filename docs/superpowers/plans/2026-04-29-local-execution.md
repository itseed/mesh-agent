# Local Execution + Path Routing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended), superpowers:executing-plans, or **dispatch to spawned tmux agents** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spawned-agent approach:** Dispatch via tmux paste-buffer to team panes (`dev-team:0.3` = backend, `dev-team:0.1` = frontend). Run Task 1 + Task 2 + Task 4 in parallel (different packages/layers); Task 3 must wait until Task 1 + Task 2 are complete.

**Goal:** Add a Cloud/Local toggle to the chat input so agents can run directly on the user's local machine via the companion tunnel, while also fixing cloud path routing to use the server-side git clone instead of user-local paths.

**Architecture:** Four sequential tasks: (1) schema migration adds `executionMode` to `agentSessions`; (2) companion gains `agent.spawn/stdout/kill` handlers that spawn real CLI processes; (3) API `dispatchAgent()` routes to companion when `executionMode === 'local'`; (4) `CommandBar` gets a Cloud/Local pill toggle that sends `executionMode` with every chat message.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, Node.js `child_process.spawn`, React, Tailwind CSS, WebSocket JSON-RPC

---

## File Map

| File                                        | Action | Responsibility                                                                                               |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/schema.ts`             | Modify | Add `executionMode` column to `agentSessions`                                                                |
| `packages/companion/src/handlers/agent.ts`  | Create | `agent.spawn`, `agent.stdout`, `agent.kill` — spawn local CLI processes                                      |
| `packages/companion/src/client.ts`          | Modify | Register the three new agent handlers in HANDLERS map                                                        |
| `apps/api/src/lib/dispatch.ts`              | Modify | Route to `companionManager.call('agent.spawn')` when `executionMode === 'local'`; create local session in DB |
| `apps/api/src/routes/chat.ts`               | Modify | Accept `executionMode` in request body; pass to `dispatchAgent`; use `workspacePath` for cloud agents        |
| `apps/web/lib/api.ts`                       | Modify | Add `executionMode` to `chat.send()` payload type                                                            |
| `apps/web/components/layout/CommandBar.tsx` | Modify | Add Cloud/Local toggle pill + companion status polling                                                       |

---

## Task 1: Add executionMode to agentSessions Schema

**Files:**

- Modify: `packages/shared/src/schema.ts`

- [ ] **Step 1: Add the column**

Open `packages/shared/src/schema.ts`. Find the `agentSessions` pgTable definition (around line 73). Add `executionMode` after `cliProvider`:

```typescript
    cliProvider: text('cli_provider'),
    executionMode: text('execution_mode').notNull().default('cloud'),  // ADD THIS
    pid: integer('pid'),
```

- [ ] **Step 2: Generate migration**

```bash
cd /Users/kriangkrai/project/mesh-agent && pnpm db:generate
```

Expected: a new migration file appears in `packages/shared/src/migrations/` with `ALTER TABLE agent_sessions ADD COLUMN execution_mode text NOT NULL DEFAULT 'cloud'`

- [ ] **Step 3: Run migration against local DB**

```bash
cd /Users/kriangkrai/project/mesh-agent && pnpm db:migrate
```

Expected: migration applied, no errors

- [ ] **Step 4: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/shared && pnpm tsc --noEmit
cd /Users/kriangkrai/project/mesh-agent/apps/api && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schema.ts packages/shared/src/migrations/
git commit -m "feat(schema): add executionMode column to agentSessions"
```

---

## Task 2: Companion Agent Handlers

**Files:**

- Create: `packages/companion/src/handlers/agent.ts`
- Modify: `packages/companion/src/client.ts`

- [ ] **Step 1: Create the agent handler file**

Create `packages/companion/src/handlers/agent.ts`:

```typescript
import { spawn, ChildProcess } from 'node:child_process';

interface SpawnedAgent {
  process: ChildProcess;
  stdout: string;
  role: string;
  startedAt: Date;
}

const agents = new Map<string, SpawnedAgent>();

export async function agentSpawn(params: {
  sessionId: string;
  role: string;
  workingDir: string;
  prompt: string;
  cliProvider: string;
}): Promise<{ sessionId: string }> {
  const { sessionId, role, workingDir, prompt, cliProvider } = params;

  const cmd = cliProvider === 'gemini' ? 'gemini' : 'claude';
  const args = ['--dangerously-skip-permissions', '--print', prompt];

  const proc = spawn(cmd, args, {
    cwd: workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry: SpawnedAgent = { process: proc, stdout: '', role, startedAt: new Date() };
  agents.set(sessionId, entry);

  proc.stdout.on('data', (chunk: Buffer) => {
    const e = agents.get(sessionId);
    if (e) e.stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    const e = agents.get(sessionId);
    if (e) e.stdout += chunk.toString();
  });
  proc.on('exit', () => agents.delete(sessionId));

  return { sessionId };
}

export async function agentStdout(params: {
  sessionId: string;
}): Promise<{ output: string; running: boolean }> {
  const entry = agents.get(params.sessionId);
  if (!entry) return { output: '', running: false };
  return { output: entry.stdout, running: true };
}

export async function agentKill(params: { sessionId: string }): Promise<{ ok: boolean }> {
  const entry = agents.get(params.sessionId);
  if (!entry) return { ok: false };
  entry.process.kill('SIGTERM');
  agents.delete(params.sessionId);
  return { ok: true };
}
```

- [ ] **Step 2: Register handlers in client.ts**

Open `packages/companion/src/client.ts`. Find the `HANDLERS` map (around line 10):

```typescript
const HANDLERS: Record<string, (params: any) => Promise<any>> = {
  'fs.list': fsList,
  'fs.stat': fsStat,
  'companion.ping': async () => ({ pong: true }),
};
```

Add the three new handlers:

```typescript
import { agentSpawn, agentStdout, agentKill } from './handlers/agent.js';

const HANDLERS: Record<string, (params: any) => Promise<any>> = {
  'fs.list': fsList,
  'fs.stat': fsStat,
  'companion.ping': async () => ({ pong: true }),
  'agent.spawn': agentSpawn,
  'agent.stdout': agentStdout,
  'agent.kill': agentKill,
};
```

- [ ] **Step 3: Build companion**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/companion && pnpm build
```

Expected: `dist/handlers/agent.js` created, no errors

- [ ] **Step 4: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/companion && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Smoke test — verify handlers are registered**

```bash
# In one terminal: start companion (it should list 6 handlers including agent.*)
node /Users/kriangkrai/project/mesh-agent/packages/companion/dist/cli.js connect http://localhost:4801 --token <your-token>
```

Expected output includes: `Serving: fs.list, fs.stat, agent.spawn, agent.stdout, agent.kill`

- [ ] **Step 6: Commit + publish new release**

```bash
cd /Users/kriangkrai/project/mesh-agent
git add packages/companion/src/handlers/agent.ts packages/companion/src/client.ts packages/companion/dist/
git commit -m "feat(companion): add agent.spawn, agent.stdout, agent.kill handlers"
```

Bump version and publish:

```bash
cd packages/companion
npm version patch   # bumps to 0.1.1
pnpm build
npm pack
```

Create new GitHub release:

```bash
cd /Users/kriangkrai/project/mesh-agent
git tag v0.1.1
git push origin v0.1.1
gh release create v0.1.1 packages/companion/meshagent-companion-0.1.1.tgz \
  --title "v0.1.1 — Local agent execution" \
  --notes "Adds agent.spawn, agent.stdout, agent.kill handlers for local execution mode."
```

---

## Task 3: API Routing for Local Execution

**Files:**

- Modify: `apps/api/src/lib/dispatch.ts`
- Modify: `apps/api/src/routes/chat.ts`

- [ ] **Step 1: Update dispatch.ts to support local mode**

Open `apps/api/src/lib/dispatch.ts`. Replace the full file with:

```typescript
import { companionManager } from './companionManager.js';
import { agentSessions } from '@meshagent/shared';
import { eq } from 'drizzle-orm';

interface DispatchOptions {
  projectId: string;
  taskId: string;
  createdBy: string;
  cliProvider: string;
  executionMode?: 'cloud' | 'local';
  userId?: string;
  db?: any;
}

export async function dispatchAgent(
  role: string,
  workingDir: string,
  prompt: string,
  options: DispatchOptions,
  systemPrompt?: string,
): Promise<{ id: string }> {
  const {
    projectId,
    taskId,
    createdBy,
    cliProvider,
    executionMode = 'cloud',
    userId,
    db,
  } = options;

  if (executionMode === 'local') {
    if (!userId) throw new Error('userId required for local execution');
    const sessionId = `local-${crypto.randomUUID()}`;

    // Store session in DB before spawning (so UI sees it immediately)
    if (db) {
      await db.insert(agentSessions).values({
        id: sessionId,
        role,
        workingDir,
        prompt,
        status: 'running',
        projectId: projectId || null,
        taskId: taskId || null,
        cliProvider,
        executionMode: 'local',
        createdBy,
        startedAt: new Date(),
      });
    }

    // Spawn on local machine via companion tunnel
    try {
      await companionManager.call(userId, 'agent.spawn', {
        sessionId,
        role,
        workingDir,
        prompt,
        cliProvider,
      });
    } catch (err: any) {
      if (db) {
        await db
          .update(agentSessions)
          .set({ status: 'errored', error: err.message, endedAt: new Date() })
          .where(eq(agentSessions.id, sessionId));
      }
      throw err;
    }

    return { id: sessionId };
  }

  // Cloud path — existing orchestrator dispatch
  const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3002';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        workingDir,
        prompt,
        projectId,
        taskId,
        createdBy,
        cliProvider,
        systemPrompt,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Orchestrator error: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function buildGitInstructions(baseBranch: string, taskId: string): string {
  return `
## Git Instructions
- Base branch: ${baseBranch}
- Create a new branch: task/${taskId}
- Commit frequently with descriptive messages
- When done, output exactly: TASK_COMPLETE
`.trim();
}
```

- [ ] **Step 2: Update chat.ts to accept executionMode**

Open `apps/api/src/routes/chat.ts`. Make three changes:

**Change A** — Add `executionMode` to `sendSchema` (around line 33):

```typescript
const sendSchema = z.object({
  message: z.string().min(1).max(32000),
  images: z
    .array(z.object({ name: z.string(), mimeType: z.string(), data: z.string() }))
    .optional(),
  projectId: z.string().optional(),
  workingDir: z.string().max(1024).optional(),
  executionMode: z.enum(['cloud', 'local']).optional().default('cloud'), // ADD THIS
});
```

**Change B** — Extract `executionMode` from body and pass context (around line 327):

```typescript
const { message, images, projectId, workingDir, executionMode = 'cloud' } = sendSchema.parse(body);
```

Store `executionMode` in the proposal (find `StoredProposal` creation around line 392):

```typescript
const proposal: StoredProposal = {
  id: proposalId,
  roles: decision.roles,
  workingDir: ctx.workingDir,
  waves: decision.waves ?? [],
  executionMode, // ADD THIS
};
```

Add `executionMode` field to `StoredProposal` interface (around line 47):

```typescript
interface StoredProposal {
  id: string;
  roles: LeadRole[];
  workingDir: string;
  waves: LeadWave[];
  executionMode: 'cloud' | 'local'; // ADD THIS
}
```

**Change C** — In the dispatch handler, use `workspacePath` for cloud and pass `executionMode` (around line 468):

```typescript
// Replace the existing agentWorkingDir line (around line 494):
const agentWorkingDir =
  proposal.executionMode === 'local'
    ? (projectPaths[r.slug] ?? Object.values(projectPaths)[0] ?? proposal.workingDir)
    : (ctx.workspacePath ??
      projectPaths[r.slug] ??
      Object.values(projectPaths)[0] ??
      proposal.workingDir);

// Add workspacePath to ctx — update resolveProjectContext return type to include it:
```

Update `resolveProjectContext` to also return `workspacePath`:

```typescript
async function resolveProjectContext(
  fastify: any,
  projectId: string | undefined,
  workingDir: string | undefined,
): Promise<{
  projectId: string | null;
  workingDir: string;
  baseBranch: string;
  projectName: string | null;
  projectPaths: Record<string, string>;
  workspacePath: string | null; // ADD THIS
}> {
  // ... existing code ...
  // In the proj block, add:
  const workspacePath = proj?.workspacePath ?? null;

  return {
    projectId: resolvedProjectId,
    workingDir: resolvedWorkingDir ?? '/tmp',
    baseBranch,
    projectName,
    projectPaths,
    workspacePath, // ADD THIS
  };
}
```

Pass `executionMode`, `userId`, and `db` to `dispatchAgent` (around line 514):

```typescript
const result = await dispatchAgent(
  r.slug,
  agentWorkingDir,
  fullPrompt,
  {
    projectId: ctx.projectId ?? '',
    taskId,
    createdBy: userId,
    cliProvider: selectedProvider,
    executionMode: proposal.executionMode, // ADD THIS
    userId, // ADD THIS
    db: fastify.db, // ADD THIS
  },
  role?.systemPrompt ?? undefined,
);
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Integration test — local dispatch returns 503 when companion not connected**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api && pnpm test src/__tests__/companion.test.ts
```

Expected: existing tests pass. (Full local dispatch test requires a live companion — manual test in Step 5)

- [ ] **Step 5: Manual smoke test**

Start the stack and connect companion:

```bash
cd /Users/kriangkrai/project/mesh-agent && docker compose up -d
mesh-companion connect http://localhost:4801 --token <your-token>
```

Send a chat message with `executionMode: 'local'` via curl:

```bash
TOKEN=$(curl -s -X POST http://localhost:4801/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' | jq -r '.token')

curl -X POST http://localhost:4801/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"say hello","executionMode":"local","projectId":"<your-project-id>"}'
```

Expected: 200 response, agent session created in DB with `execution_mode = 'local'`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/dispatch.ts apps/api/src/routes/chat.ts
git commit -m "feat(api): route local executionMode through companion tunnel"
```

---

## Task 4: UI Cloud/Local Toggle

**Files:**

- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/layout/CommandBar.tsx`

- [ ] **Step 1: Update api.ts chat.send type**

Open `apps/web/lib/api.ts`. Find the `chat` section and the `send` method. Add `executionMode` to the payload type:

```typescript
    send: (payload: {
      message: string
      images?: { name: string; mimeType: string; data: string }[]
      projectId?: string
      executionMode?: 'cloud' | 'local'
    }) => request<void>('/chat', { method: 'POST', body: JSON.stringify(payload) }),
```

- [ ] **Step 2: Add toggle state to CommandBar**

Open `apps/web/components/layout/CommandBar.tsx`. Find the existing state declarations (around line 100) and add:

```typescript
const [executionMode, setExecutionMode] = useState<'cloud' | 'local'>('cloud');
const [companionConnected, setCompanionConnected] = useState(false);
```

- [ ] **Step 3: Add companion status polling**

Find the existing `useEffect` hooks in `CommandBar`. Add a new one after the existing effects:

```typescript
useEffect(() => {
  const check = () =>
    api.companion
      .status()
      .then((s) => setCompanionConnected(s.connected))
      .catch(() => setCompanionConnected(false));
  check();
  const t = setInterval(check, 10_000);
  return () => clearInterval(t);
}, []);
```

- [ ] **Step 4: Pass executionMode in send payload**

Find the `payload` object in the `send` function (around line 233):

```typescript
    const payload = {
      message: fullMessage,
      images: attachments.map((a) => ({ ... })),
      projectId: selectedProjectId || undefined,
      executionMode,  // ADD THIS
    }
```

Also update `sendQuickReply` (around line 259):

```typescript
await api.chat.send({ message: text, projectId: selectedProjectId || undefined, executionMode });
```

- [ ] **Step 5: Add the toggle pill to the input bar**

Find the input bar JSX — the row that contains the attach button, textarea, and send button (around line 525). Add the toggle between the attach button and the textarea:

```tsx
{
  /* Execution mode toggle */
}
<div className="flex bg-canvas border border-border rounded-md overflow-hidden text-[11px] shrink-0">
  <button
    type="button"
    onClick={() => setExecutionMode('cloud')}
    className={`px-2.5 py-1.5 transition-colors ${
      executionMode === 'cloud' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'
    }`}
  >
    ☁
  </button>
  <button
    type="button"
    onClick={() => companionConnected && setExecutionMode('local')}
    disabled={!companionConnected}
    title={
      companionConnected
        ? 'Local — รันบนเครื่องผ่าน companion'
        : 'Connect companion ก่อน — Settings → Companion'
    }
    className={`px-2.5 py-1.5 transition-colors border-l border-border ${
      executionMode === 'local'
        ? 'bg-accent/15 text-accent'
        : companionConnected
          ? 'text-muted hover:text-text'
          : 'text-dim cursor-not-allowed opacity-40'
    }`}
  >
    💻
  </button>
</div>;
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/web && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Visual verify**

Rebuild and open http://localhost:4800:

```bash
cd /Users/kriangkrai/project/mesh-agent && docker compose build web && docker compose up -d web
```

**Without companion connected:**

- Chat input shows ☁ (active) and 💻 (dimmed, disabled)
- Hover on 💻 shows tooltip "Connect companion ก่อน"

**With companion connected:**

- Both ☁ and 💻 are clickable
- Clicking 💻 highlights it; clicking ☁ switches back
- Send a message — check API logs that `executionMode: 'local'` reaches the route

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/api.ts apps/web/components/layout/CommandBar.tsx
git commit -m "feat(web): add cloud/local execution mode toggle to chat input"
```

---

## Self-Review

### Spec Coverage

| Spec requirement                                                | Task   |
| --------------------------------------------------------------- | ------ |
| `executionMode` column in agentSessions                         | Task 1 |
| Drizzle migration                                               | Task 1 |
| `agent.spawn(sessionId, role, workingDir, prompt, cliProvider)` | Task 2 |
| `agent.stdout(sessionId)`                                       | Task 2 |
| `agent.kill(sessionId)`                                         | Task 2 |
| Register handlers in companion client.ts                        | Task 2 |
| API routes local → companionManager.call                        | Task 3 |
| Cloud path uses `workspacePath` (server clone)                  | Task 3 |
| Local path uses `projectPaths[role]`                            | Task 3 |
| `executionMode` accepted in `/chat` body                        | Task 3 |
| `executionMode` stored in agentSessions row                     | Task 3 |
| Cloud/Local pill in chat input bar                              | Task 4 |
| Local disabled when companion not connected                     | Task 4 |
| Tooltip when disabled                                           | Task 4 |
| Companion status polled every 10s                               | Task 4 |
| `executionMode` sent with every dispatch                        | Task 4 |

### Placeholder Scan

None found.

### Type Consistency

- `dispatchAgent(role, workingDir, prompt, options, systemPrompt?)` — called identically in Task 3 and declared in Task 3 ✓
- `executionMode: 'cloud' | 'local'` — consistent across schema (Task 1), dispatch (Task 3), API client (Task 4), CommandBar (Task 4) ✓
- `companionManager.call(userId, 'agent.spawn', { sessionId, role, workingDir, prompt, cliProvider })` — params match `agentSpawn` handler signature in Task 2 ✓
- `StoredProposal.executionMode` — added in Task 3, read in Task 3 dispatch loop ✓

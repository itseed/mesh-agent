# Local Execution + Path Routing Fix Design

## Goal

Fix the path routing bug (all roles sent to the first path) and add a Cloud/Local execution toggle to the chat input so users can run agents directly on their local machine via the companion tunnel.

## Decisions

| Decision                       | Choice                                                         | Reason                                                   |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| Toggle placement               | Chat input bar (pill toggle)                                   | Per-dispatch, not per-project; mirrors model selector UX |
| "Local" definition             | Companion tunnel → spawn process on user's machine             | Uses existing companion infrastructure                   |
| When companion disconnected    | Local pill disabled + tooltip                                  | No silent failure; clear affordance                      |
| Path routing fix scope         | Applies to both cloud and local                                | Bug exists today; fix once, shared by both modes         |
| Path source for local          | `projectPaths[role]` set via folder browser                    | Already built in Subsystem 2                             |
| Path source for cloud          | `project.workspacePath` (cloned repo on server) + role subpath | Existing clone mechanism                                 |
| executionMode persistence      | React state per chat session (not DB)                          | Per-dispatch toggle; no need to persist across sessions  |
| executionMode in agentSessions | Add `executionMode` column                                     | Needed for session tracking + future analytics           |

## Scope

- Fix `chat.ts` path routing bug (role → correct path)
- Companion `agent.spawn`, `agent.stdout`, `agent.kill` handlers
- API `dispatchAgent()` routing by executionMode
- Chat UI cloud/local toggle
- `agentSessions.executionMode` schema field

**Out of scope:** stdout streaming to UI (future), process supervision/restart, multi-machine routing

## New / Modified Files

| File                                             | Action | Responsibility                                       |
| ------------------------------------------------ | ------ | ---------------------------------------------------- |
| `apps/api/src/routes/chat.ts`                    | Modify | Fix path routing: use `projectPaths[role]` per role  |
| `packages/shared/src/schema.ts`                  | Modify | Add `executionMode` column to `agentSessions`        |
| `apps/api/src/lib/dispatch.ts`                   | Modify | Route to companion when `executionMode === 'local'`  |
| `packages/companion/src/handlers/agent.ts`       | Create | `agent.spawn`, `agent.stdout`, `agent.kill` handlers |
| `packages/companion/src/client.ts`               | Modify | Register agent handlers                              |
| `apps/web/app/chat/page.tsx` (or chat component) | Modify | Cloud/Local toggle pill in input bar                 |
| `apps/web/lib/api.ts`                            | Modify | Pass `executionMode` in dispatch request             |

## Task 1: Path Routing Bug Fix

### Problem

`apps/api/src/routes/chat.ts` line 155:

```typescript
resolvedWorkingDir = Object.values(projectPaths)[0] ?? '/tmp';
```

Every role gets the same first path regardless of its actual role key.

### Fix

The dispatch loop must pass each agent's role to `resolveProjectContext` (or resolve paths at dispatch time):

```typescript
// In resolveProjectContext — change signature to accept role
async function resolveProjectContext(
  fastify,
  projectId: string | undefined,
  workingDir: string | undefined,
  role?: string, // NEW
) {
  // ...
  if (!resolvedWorkingDir) {
    resolvedWorkingDir = role
      ? (projectPaths[role] ?? Object.values(projectPaths)[0] ?? '/tmp')
      : (Object.values(projectPaths)[0] ?? '/tmp');
  }
}
```

Caller passes `role` when dispatching each agent in the wave loop.

**Path source by mode:**

- `executionMode === 'local'` → `projectPaths[role]` (user's machine path, set via folder browser)
- `executionMode === 'cloud'` → `project.workspacePath` (server-side git clone); fall back to `projectPaths[role]` only if `workspacePath` is null (no GitHub repo configured)

## Task 2: Companion Agent Handlers

New file: `packages/companion/src/handlers/agent.ts`

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
  cliProvider: 'claude' | 'gemini' | 'cursor';
}): Promise<{ sessionId: string }> {
  const { sessionId, role, workingDir, prompt, cliProvider } = params;

  const cmd = cliProvider === 'gemini' ? 'gemini' : 'claude';
  const args = ['--dangerously-skip-permissions', '--print', prompt];

  const proc = spawn(cmd, args, {
    cwd: workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  agents.set(sessionId, { process: proc, stdout: '', role, startedAt: new Date() });

  proc.stdout.on('data', (chunk: Buffer) => {
    const entry = agents.get(sessionId);
    if (entry) entry.stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    const entry = agents.get(sessionId);
    if (entry) entry.stdout += chunk.toString();
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

Register in `packages/companion/src/client.ts`:

```typescript
import { agentSpawn, agentStdout, agentKill } from './handlers/agent.js'

// Add to HANDLERS map:
'agent.spawn': agentSpawn,
'agent.stdout': agentStdout,
'agent.kill': agentKill,
```

## Task 3: API Routing by executionMode

### Schema change

`packages/shared/src/schema.ts` — add to `agentSessions`:

```typescript
executionMode: text('execution_mode').notNull().default('cloud'),
// values: 'cloud' | 'local'
```

### dispatch.ts change

```typescript
export async function dispatchAgent(
  role: string,
  workingDir: string,
  prompt: string,
  projectId: string,
  taskId: string,
  cliProvider: string,
  executionMode: 'cloud' | 'local', // NEW
  userId: string, // NEW (for companion lookup)
) {
  if (executionMode === 'local') {
    const sessionId = `local-${crypto.randomUUID()}`;
    await companionManager.call(userId, 'agent.spawn', {
      sessionId,
      role,
      workingDir,
      prompt,
      cliProvider,
    });
    // store session in DB with executionMode: 'local'
    return { sessionId };
  }

  // existing cloud path
  const res = await fetch(`${env.ORCHESTRATOR_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, workingDir, prompt, projectId, taskId, cliProvider }),
  });
  return res.json();
}
```

### chat.ts change

Accept `executionMode` from request body (defaults to `'cloud'`):

```typescript
const { message, projectId, workingDir, executionMode = 'cloud' } = body;
```

Pass `executionMode` and `userId` through to `dispatchAgent()`.

## Task 4: UI Toggle

### Chat input bar

Add to the chat input component (find the send bar):

```tsx
// State
const [executionMode, setExecutionMode] = useState<'cloud' | 'local'>('cloud')
const [companionConnected, setCompanionConnected] = useState(false)

// On mount: check companion status, then poll every 10s
useEffect(() => {
  const check = () =>
    api.companion.status()
      .then(s => setCompanionConnected(s.connected))
      .catch(() => setCompanionConnected(false))
  check()
  const t = setInterval(check, 10_000)
  return () => clearInterval(t)
}, [])

// Toggle UI (inside input bar, left of send button)
<div className="flex bg-canvas border border-border rounded-md overflow-hidden text-[11px]">
  <button
    type="button"
    onClick={() => setExecutionMode('cloud')}
    className={`px-3 py-1.5 transition-colors ${
      executionMode === 'cloud'
        ? 'bg-accent/10 text-accent'
        : 'text-muted hover:text-text'
    }`}
  >
    ☁ Cloud
  </button>
  <button
    type="button"
    onClick={() => companionConnected && setExecutionMode('local')}
    disabled={!companionConnected}
    title={companionConnected ? undefined : 'Connect companion first — Settings → Companion'}
    className={`px-3 py-1.5 transition-colors border-l border-border ${
      executionMode === 'local'
        ? 'bg-accent/10 text-accent'
        : companionConnected
          ? 'text-muted hover:text-text'
          : 'text-dim cursor-not-allowed opacity-50'
    }`}
  >
    💻 Local
  </button>
</div>
```

Pass `executionMode` with every send:

```typescript
// In api.ts — add executionMode to chat dispatch call
await api.chat.send({ message, projectId, executionMode });
```

## Error Handling

| Scenario                                          | Behaviour                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| Local selected, companion disconnects mid-session | `companionManager.call` throws → API returns 503 → UI shows error toast |
| Local selected, `workingDir` doesn't exist        | `spawn` fails → companion returns error → agentSession status `errored` |
| Cloud selected, orchestrator unreachable          | Existing error handling unchanged                                       |
| Role has no path in projectPaths                  | Fall back to first available path; log warning                          |

## Migration

```sql
ALTER TABLE agent_sessions ADD COLUMN execution_mode text NOT NULL DEFAULT 'cloud';
```

Drizzle migration generated automatically via `pnpm db:generate`.

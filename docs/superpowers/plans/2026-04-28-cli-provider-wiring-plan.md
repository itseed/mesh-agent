# CLI Provider Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `cli` field from the UI dispatch form through the API and orchestrator so agents actually run with the chosen CLI (claude/gemini/cursor).

**Architecture:** Two-task fix: (1) API `agents.ts` accepts `cli`, forwards as `cliProvider` to orchestrator, saves to DB. (2) Orchestrator `sessions.ts` + `manager.ts` accept and pass `cliProvider` through to `AgentSession` which already handles it via `buildCliArgs()`. Dockerfiles already have all three CLIs installed — no Dockerfile changes needed.

**Tech Stack:** Fastify, Zod, Drizzle ORM, Vitest

---

## File Map

| Action | Path |
|---|---|
| **Modify** | `apps/api/src/routes/agents.ts` |
| **Create** | `apps/api/src/__tests__/agents-cli.test.ts` |
| **Modify** | `packages/orchestrator/src/routes/sessions.ts` |
| **Modify** | `packages/orchestrator/src/manager.ts` |

---

## Task 1: API — accept `cli`, forward to orchestrator, save to DB

**Files:**
- Modify: `apps/api/src/routes/agents.ts:8-101`
- Create: `apps/api/src/__tests__/agents-cli.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/__tests__/agents-cli.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { agentRoutes } from '../routes/agents.js'

// Capture fetch calls
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function buildMockDb(roleExists = true) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(roleExists ? [{ slug: 'backend', name: 'Backend', isBuiltin: true }] : []),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }
}

async function buildApp(dbOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  // Mock authenticate decorator
  app.decorate('authenticate', async (_req: any, _reply: any) => {
    _req.user = { id: 'user-1', role: 'admin' }
  })

  // Mock db decorator
  app.decorate('db', { ...buildMockDb(), ...dbOverrides })

  // Mock redis (for audit log)
  app.decorate('redis', { publish: vi.fn() })

  await app.register(agentRoutes)
  return app
}

describe('POST /agents — cli provider forwarding', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    fetchMock.mockReset()
    app = await buildApp()
  })
  afterEach(async () => { await app.close() })

  it('forwards cliProvider to orchestrator when cli is provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sess-1', role: 'backend', status: 'pending' }),
    })

    await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        role: 'backend',
        workingDir: '/tmp/work',
        prompt: 'do something',
        cli: 'gemini',
      },
    })

    const [[url, init]] = fetchMock.mock.calls
    expect(url).toContain('/sessions')
    const body = JSON.parse((init as any).body)
    expect(body.cliProvider).toBe('gemini')
  })

  it('does not include cliProvider when cli is absent', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sess-2', role: 'backend', status: 'pending' }),
    })

    await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do something' },
    })

    const [[, init]] = fetchMock.mock.calls
    const body = JSON.parse((init as any).body)
    expect(body.cliProvider).toBeUndefined()
  })

  it('rejects unknown cli value with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do', cli: 'unknown-cli' },
    })
    expect(res.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test → verify FAIL**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api
npm run test -- agents-cli.test
```

Expected: FAIL — `cli` not in dispatchSchema, `cliProvider` not in fetch body

- [ ] **Step 3: Update `apps/api/src/routes/agents.ts`**

**Change 1:** Update `dispatchSchema` (lines 8-14):
```typescript
const dispatchSchema = z.object({
  role: z.string().min(1).max(64),
  workingDir: z.string().min(1).max(1024),
  prompt: z.string().min(1).max(64 * 1024),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  cli: z.enum(['claude', 'gemini', 'cursor']).optional(),
})
```

**Change 2:** Update the orchestrator fetch body in `POST /agents` (lines 79-86):
```typescript
body: JSON.stringify({
  role: body.role,
  workingDir: body.workingDir,
  prompt: body.prompt,
  projectId: body.projectId ?? null,
  taskId: body.taskId ?? null,
  createdBy: userId,
  ...(body.cli ? { cliProvider: body.cli } : {}),
}),
```

**Change 3:** After `const json = await res.json()` (line 94), add fire-and-forget DB save:
```typescript
const json = await res.json()
const sessionId = (json as any).id as string | undefined
if (sessionId && body.cli) {
  fastify.db
    .update(agentSessions)
    .set({ cliProvider: body.cli })
    .where(eq(agentSessions.id, sessionId))
    .catch((err: unknown) => fastify.log.warn({ err, sessionId }, 'Failed to save cliProvider'))
}
```

Also add `eq` to the existing import from drizzle-orm (line 3) if not already present — it is already imported.

- [ ] **Step 4: Run test → verify PASS**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api
npm run test -- agents-cli.test
```

Expected: 3 tests PASS

- [ ] **Step 5: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/kriangkrai/project/mesh-agent
git add apps/api/src/routes/agents.ts apps/api/src/__tests__/agents-cli.test.ts
git commit -m "feat(api): accept cli field in dispatch, forward cliProvider to orchestrator"
```

---

## Task 2: Orchestrator — wire cliProvider through sessions.ts → manager.ts

**Files:**
- Modify: `packages/orchestrator/src/routes/sessions.ts:7-16,44-53`
- Modify: `packages/orchestrator/src/manager.ts:7-16,47-57`

- [ ] **Step 1: Write failing test**

Add to `packages/orchestrator/src/__tests__/sessions-git.test.ts` — add a new describe block at the end of the file:

```typescript
describe('POST /sessions with cliProvider', () => {
  let app: FastifyInstance
  let createSessionMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    createSessionMock = vi.fn().mockResolvedValue({
      id: 'sess-p',
      role: 'backend',
      status: 'pending',
      start: vi.fn().mockResolvedValue({}),
    })
    app = await buildApp({ createSession: createSessionMock })
  })
  afterEach(async () => { await app.close() })

  it('passes cliProvider to manager.createSession when provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        role: 'backend',
        workingDir: '/tmp/work',
        prompt: 'do something',
        cliProvider: 'gemini',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ cliProvider: 'gemini' }),
    )
  })

  it('does not include cliProvider when absent', async () => {
    await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do something' },
    })
    const call = createSessionMock.mock.calls[0][0]
    expect(call.cliProvider).toBeUndefined()
  })

  it('rejects invalid cliProvider value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do', cliProvider: 'bad-cli' },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

Note: `buildApp` and `buildMockManager` helpers already exist in `sessions-git.test.ts` — reuse them. The `buildMockManager` needs to accept `createSession` override — check if the existing helper supports it; if not, pass `{ createSession: createSessionMock }` as manager override.

- [ ] **Step 2: Run test → verify FAIL**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/orchestrator
npm run test -- sessions-git.test
```

Expected: new tests FAIL — `cliProvider` not in schema, not passed to manager

- [ ] **Step 3: Update `packages/orchestrator/src/routes/sessions.ts`**

**Change 1:** Add `cliProvider` to `createSessionSchema` (after `repoUrl` line):
```typescript
cliProvider: z.enum(['claude', 'gemini', 'cursor']).optional().nullable(),
```

**Change 2:** Add `cliProvider` to `manager.createSession({...})` call (after `repoBaseDir` line):
```typescript
cliProvider: body.cliProvider ?? undefined,
```

- [ ] **Step 4: Update `packages/orchestrator/src/manager.ts`**

**Change 1:** Add `cliProvider` to `CreateSessionOpts` interface (after `systemPrompt?`):
```typescript
cliProvider?: CliProvider | null
```

Add the import at top of manager.ts:
```typescript
import type { CliProvider } from './session.js'
```

**Change 2:** Add `cliProvider` to `new AgentSession({...})` call (after `systemPrompt: input.systemPrompt`):
```typescript
cliProvider: input.cliProvider ?? undefined,
```

- [ ] **Step 5: Run tests → verify PASS**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/orchestrator
npm run test -- sessions-git.test
npm run test
```

Expected: all 3 new tests PASS, all 36 tests PASS

- [ ] **Step 6: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/orchestrator
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd /Users/kriangkrai/project/mesh-agent
git add packages/orchestrator/src/routes/sessions.ts \
        packages/orchestrator/src/manager.ts \
        packages/orchestrator/src/__tests__/sessions-git.test.ts
git commit -m "feat(orchestrator): accept cliProvider in sessions route, wire through manager to AgentSession"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered in |
|---|---|
| `agents.ts` dispatchSchema adds `cli` field | Task 1 Step 3 Change 1 |
| Forward `cliProvider` to orchestrator | Task 1 Step 3 Change 2 |
| Save `cliProvider` to `agentSessions` DB | Task 1 Step 3 Change 3 |
| `sessions.ts` schema adds `cliProvider` | Task 2 Step 3 Change 1 |
| `manager.ts` `CreateSessionOpts` adds `cliProvider` | Task 2 Step 4 Change 1 |
| `manager.ts` passes `cliProvider` to `new AgentSession` | Task 2 Step 4 Change 2 |
| Auto dispatch (tasks.ts) unchanged — always claude | `dispatch.ts` not modified |
| Invalid cli → 400 | Task 1 test 3, Task 2 test 3 |
| Missing cli → no cliProvider in body | Task 1 test 2, Task 2 test 2 |
| Dockerfiles already have all CLIs | No Dockerfile changes needed |

# Orchestrator Prompt Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all `claude` CLI spawning from the API container to the orchestrator so that the API container no longer needs the claude binary installed.

**Architecture:** Add `POST /prompt` and `GET /health/claude` (and `POST /health/claude/token`) to the orchestrator. API's `lead.ts` replaces `execFileAsync` calls with `fetch` to the orchestrator. API's `settings.ts` proxies test and token-save endpoints to the orchestrator and drops the now-meaningless cmd-override routes. Frontend removes the cmd override UI.

**Tech Stack:** Fastify, Node.js `child_process`, vitest, React/Next.js, TypeScript

---

## File Map

| File | Action |
|---|---|
| `packages/orchestrator/src/routes/prompt.ts` | CREATE — 3 new route handlers |
| `packages/orchestrator/src/server.ts` | MODIFY — register `promptRoutes` |
| `packages/orchestrator/src/__tests__/prompt.test.ts` | CREATE — route unit tests |
| `apps/api/src/lib/lead.ts` | MODIFY — replace `execFileAsync` with `fetch` |
| `apps/api/src/__tests__/lead.test.ts` | CREATE — unit tests for `runLead` / `runLeadSynthesis` |
| `apps/api/src/routes/settings.ts` | MODIFY — proxy test + token, remove cmd override |
| `apps/api/src/__tests__/settings.test.ts` | CREATE — settings route tests |
| `apps/web/lib/api.ts` | MODIFY — remove `saveCliCmd` / `resetCliCmd` |
| `apps/web/app/settings/page.tsx` | MODIFY — remove cmd override UI, remove cliSource badge |

---

### Task 1: Orchestrator — prompt route (TDD)

**Files:**
- Create: `packages/orchestrator/src/routes/prompt.ts`
- Create: `packages/orchestrator/src/__tests__/prompt.test.ts`
- Modify: `packages/orchestrator/src/server.ts`

- [ ] **Step 1: Write failing tests for all three endpoints**

Create `packages/orchestrator/src/__tests__/prompt.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}))
vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { execFile, execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { promptRoutes } from '../routes/prompt.js'

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(promptRoutes)
  return app
}

describe('POST /prompt', () => {
  let app: FastifyInstance
  beforeEach(async () => { app = await buildApp() })
  afterEach(async () => { await app.close() })

  it('returns stdout on success', async () => {
    ;(execFile as any).mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, { stdout: '{"result":"ok"}' })
      }
    )
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'hello', timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().stdout).toBe('{"result":"ok"}')
  })

  it('returns 504 when claude is killed (timeout)', async () => {
    ;(execFile as any).mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error('Process killed')
        err.killed = true
        cb(err)
      }
    )
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'hello', timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(504)
  })

  it('returns 500 on non-timeout error', async () => {
    ;(execFile as any).mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error('ENOENT: no such file'))
      }
    )
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'hello', timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toContain('ENOENT')
  })

  it('rejects prompt exceeding max length', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'x'.repeat(65 * 1024), timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /health/claude', () => {
  let app: FastifyInstance
  beforeEach(async () => { app = await buildApp() })
  afterEach(async () => { await app.close() })

  it('returns ok=true with resolved cmd and version', async () => {
    ;(execFileSync as any)
      .mockReturnValueOnce('/usr/local/bin/claude\n')  // which
      .mockReturnValueOnce('claude/1.2.3 linux-x64\n') // --version
    const res = await app.inject({ method: 'GET', url: '/health/claude' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      ok: true,
      version: 'claude/1.2.3 linux-x64',
      cmd: '/usr/local/bin/claude',
    })
  })

  it('falls back to CLAUDE_CMD when which fails', async () => {
    ;(execFileSync as any)
      .mockImplementationOnce(() => { throw new Error('not found') }) // which fails
      .mockReturnValueOnce('claude/1.0.0\n')                          // --version ok
    const res = await app.inject({ method: 'GET', url: '/health/claude' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.cmd).toBe('claude') // env default
  })

  it('returns ok=false when claude binary is missing', async () => {
    ;(execFileSync as any)
      .mockImplementationOnce(() => { throw new Error('which: no claude') }) // which
      .mockImplementationOnce(() => { throw new Error('ENOENT') })           // --version
    const res = await app.inject({ method: 'GET', url: '/health/claude' })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(false)
    expect(res.json().error).toBeTruthy()
  })
})

describe('POST /health/claude/token', () => {
  let app: FastifyInstance
  beforeEach(async () => { app = await buildApp() })
  afterEach(async () => { await app.close() })

  it('writes token to /root/.claude/token', async () => {
    ;(mkdirSync as any).mockReturnValue(undefined)
    ;(writeFileSync as any).mockReturnValue(undefined)
    const res = await app.inject({
      method: 'POST',
      url: '/health/claude/token',
      payload: { token: 'abc123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, path: '/root/.claude/token' })
    expect(writeFileSync).toHaveBeenCalledWith('/root/.claude/token', 'abc123', { mode: 0o600 })
  })

  it('returns 500 when write fails', async () => {
    ;(mkdirSync as any).mockReturnValue(undefined)
    ;(writeFileSync as any).mockImplementation(() => { throw new Error('Permission denied') })
    const res = await app.inject({
      method: 'POST',
      url: '/health/claude/token',
      payload: { token: 'abc123' },
    })
    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Run tests — verify they all fail with "Cannot find module"**

```bash
cd packages/orchestrator && pnpm test 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../routes/prompt.js'`

- [ ] **Step 3: Create the route file**

Create `packages/orchestrator/src/routes/prompt.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from '../env.js'

const execFileAsync = promisify(execFile)

const promptBodySchema = z.object({
  prompt: z.string().min(1).max(64 * 1024),
  timeoutMs: z.coerce.number().int().positive().max(120_000).default(60_000),
})

const tokenBodySchema = z.object({
  token: z.string().min(1).max(4096),
})

export async function promptRoutes(fastify: FastifyInstance) {
  fastify.post('/prompt', async (request, reply) => {
    const { prompt, timeoutMs } = promptBodySchema.parse(request.body)
    try {
      const { stdout } = await execFileAsync(
        env.CLAUDE_CMD,
        ['--output-format', 'json', '-p', prompt],
        { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env },
      )
      return { stdout }
    } catch (err: any) {
      if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        return reply.status(504).send({ error: 'claude timed out' })
      }
      return reply.status(500).send({ error: err.message ?? 'claude failed' })
    }
  })

  fastify.get('/health/claude', async () => {
    let cmd = env.CLAUDE_CMD
    try {
      const resolved = execFileSync('which', [env.CLAUDE_CMD], { encoding: 'utf8' }).trim()
      if (resolved) cmd = resolved
    } catch {
      // keep env.CLAUDE_CMD as fallback
    }
    try {
      const version = execFileSync(env.CLAUDE_CMD, ['--version'], {
        encoding: 'utf8',
        timeout: 10_000,
        env: process.env,
      }).trim()
      return { ok: true, version, cmd }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'CLI not found', cmd }
    }
  })

  fastify.post('/health/claude/token', async (request, reply) => {
    const { token } = tokenBodySchema.parse(request.body)
    const tokenPath = '/root/.claude/token'
    try {
      mkdirSync(dirname(tokenPath), { recursive: true })
      writeFileSync(tokenPath, token, { mode: 0o600 })
    } catch (e: any) {
      return reply.status(500).send({ error: `Failed to write token: ${e?.message}` })
    }
    return { ok: true, path: tokenPath }
  })
}
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
cd packages/orchestrator && pnpm test 2>&1 | tail -20
```

Expected: all prompt tests PASS

- [ ] **Step 5: Register promptRoutes in server.ts**

In `packages/orchestrator/src/server.ts`, add:

```ts
import { promptRoutes } from './routes/prompt.js'
```

After the existing `await fastify.register(sessionRoutes, { manager, store })` line, add:

```ts
await fastify.register(promptRoutes)
```

- [ ] **Step 6: Verify typecheck passes**

```bash
cd packages/orchestrator && pnpm typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/routes/prompt.ts \
        packages/orchestrator/src/__tests__/prompt.test.ts \
        packages/orchestrator/src/server.ts
git commit -m "feat(orchestrator): add POST /prompt, GET /health/claude, POST /health/claude/token"
```

---

### Task 2: API — update lead.ts (TDD)

**Files:**
- Modify: `apps/api/src/lib/lead.ts`
- Create: `apps/api/src/__tests__/lead.test.ts`

- [ ] **Step 1: Write failing tests for runLead and runLeadSynthesis**

Create `apps/api/src/__tests__/lead.test.ts`:

```ts
import './setup.js'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { runLead, runLeadSynthesis } from '../lib/lead.js'

const validLeadJson = JSON.stringify({
  result: JSON.stringify({
    intent: 'chat',
    reply: 'Hello!',
  }),
})

const validSynthesisJson = JSON.stringify({ result: 'Nice work!' })

function mockFetchOk(body: string) {
  ;(fetch as any).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ stdout: body }),
  })
}

function mockFetchError(status: number) {
  ;(fetch as any).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: 'upstream error' }),
  })
}

describe('runLead', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls orchestrator /prompt and returns parsed decision', async () => {
    mockFetchOk(validLeadJson)
    const { decision } = await runLead('hello', [])
    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = (fetch as any).mock.calls[0]
    expect(url).toContain('/prompt')
    expect(JSON.parse(opts.body).prompt).toContain('hello')
    expect(decision.intent).toBe('chat')
    expect(decision.reply).toBe('Hello!')
  })

  it('throws when orchestrator returns non-ok status', async () => {
    mockFetchError(504)
    await expect(runLead('hello', [])).rejects.toThrow('Orchestrator error 504')
  })

  it('throws when orchestrator is unreachable', async () => {
    ;(fetch as any).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(runLead('hello', [])).rejects.toThrow()
  })
})

describe('runLeadSynthesis', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls orchestrator /prompt and returns plain text', async () => {
    mockFetchOk(validSynthesisJson)
    const text = await runLeadSynthesis({
      agentRole: 'frontend',
      success: true,
      summary: 'done',
      prUrl: null,
      context: [],
    })
    expect(text).toBe('Nice work!')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = (fetch as any).mock.calls[0]
    expect(url).toContain('/prompt')
    expect(JSON.parse(opts.body).timeoutMs).toBe(45_000)
  })

  it('throws when orchestrator returns non-ok status', async () => {
    mockFetchError(500)
    await expect(runLeadSynthesis({
      agentRole: 'backend',
      success: false,
      summary: '',
      prUrl: null,
      context: [],
    })).rejects.toThrow('Orchestrator error 500')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/api && pnpm test lead.test 2>&1 | tail -20
```

Expected: FAIL — tests call the old `execFileAsync` path, not `fetch`

- [ ] **Step 3: Rewrite lead.ts to use fetch**

Replace the top imports in `apps/api/src/lib/lead.ts`:

```ts
// Remove these 3 lines:
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
```

Add this helper after the imports (before `DEFAULT_LEAD_SYSTEM_PROMPT`):

```ts
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4802'

async function callOrchestrator(prompt: string, timeoutMs: number): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(`Orchestrator error ${res.status}: ${(body as any).error ?? 'unknown'}`)
  }
  const { stdout } = await res.json() as { stdout: string }
  return stdout
}
```

In `runLead`, replace the entire `execFileAsync` block:

```ts
// Remove:
const cmd = process.env.CLAUDE_CMD ?? 'claude'
const { stdout } = await execFileAsync(cmd, ['--output-format', 'json', '-p', prompt], {
  encoding: 'utf8',
  timeout: 60_000,
  maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env },
})

// Add:
const stdout = await callOrchestrator(prompt, 60_000)
```

In `runLeadSynthesis`, replace the `execFileAsync` block:

```ts
// Remove:
const cmd = process.env.CLAUDE_CMD ?? 'claude'
const { stdout } = await execFileAsync(cmd, ['--output-format', 'json', '-p', prompt], {
  encoding: 'utf8',
  timeout: 45_000,
  maxBuffer: 2 * 1024 * 1024,
  env: { ...process.env },
})

// Add:
const stdout = await callOrchestrator(prompt, 45_000)
```

Also remove the intermediate `let text = stdout.trim()` reassignment in `runLeadSynthesis` — it's already a `const stdout` from `callOrchestrator`. Keep the rest of the function (JSON unwrapping, strip code fences) but rename `stdout` to `text` at the point it becomes `text`:

```ts
let text = stdout.trim()
// rest of the function unchanged
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/api && pnpm test lead.test 2>&1 | tail -20
```

Expected: all 5 tests PASS

- [ ] **Step 5: Typecheck**

```bash
cd apps/api && pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/lead.ts apps/api/src/__tests__/lead.test.ts
git commit -m "feat(api): replace execFileAsync in lead.ts with fetch to orchestrator"
```

---

### Task 3: API — update settings.ts (TDD)

**Files:**
- Modify: `apps/api/src/routes/settings.ts`
- Create: `apps/api/src/__tests__/settings.test.ts`

- [ ] **Step 1: Write failing tests for the changed endpoints**

Create `apps/api/src/__tests__/settings.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import './setup.js'
import { buildServer } from '../server.js'

vi.stubGlobal('fetch', vi.fn())

describe('Settings routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let token: string

  beforeAll(async () => {
    server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@example.com', password: 'changeme123' },
    })
    token = res.json().token
  })

  afterAll(async () => { await server.close() })

  const auth = () => ({ authorization: `Bearer ${token}` })

  describe('GET /settings/claude/test', () => {
    it('proxies to orchestrator /health/claude and returns response', async () => {
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, version: 'claude/1.2.3', cmd: '/usr/local/bin/claude' }),
      })
      const res = await server.inject({
        method: 'GET',
        url: '/settings/claude/test',
        headers: auth(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, version: 'claude/1.2.3', cmd: '/usr/local/bin/claude' })
      const [url] = (fetch as any).mock.calls[0]
      expect(url).toContain('/health/claude')
    })

    it('returns ok=false when orchestrator is unreachable', async () => {
      ;(fetch as any).mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const res = await server.inject({
        method: 'GET',
        url: '/settings/claude/test',
        headers: auth(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(false)
    })
  })

  describe('POST /settings/cli/claude/token', () => {
    it('proxies token to orchestrator /health/claude/token', async () => {
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, path: '/root/.claude/token' }),
      })
      const res = await server.inject({
        method: 'POST',
        url: '/settings/cli/claude/token',
        headers: auth(),
        payload: { token: 'mytoken123' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, path: '/root/.claude/token' })
      const [url, opts] = (fetch as any).mock.calls[0]
      expect(url).toContain('/health/claude/token')
      expect(JSON.parse(opts.body).token).toBe('mytoken123')
    })
  })

  describe('Removed routes', () => {
    it('POST /settings/claude/cmd returns 404', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/settings/claude/cmd',
        headers: auth(),
        payload: { cmd: 'claude' },
      })
      expect(res.statusCode).toBe(404)
    })

    it('DELETE /settings/claude/cmd returns 404', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/settings/claude/cmd',
        headers: auth(),
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /settings', () => {
    it('no longer returns cli.cmd or cli.source', async () => {
      const res = await server.inject({ method: 'GET', url: '/settings', headers: auth() })
      expect(res.statusCode).toBe(200)
      expect(res.json().cli?.cmd).toBeUndefined()
      expect(res.json().cli?.source).toBeUndefined()
    })

    it('returns cli.orchestratorUrl', async () => {
      const res = await server.inject({ method: 'GET', url: '/settings', headers: auth() })
      expect(res.json().cli?.orchestratorUrl).toBeTruthy()
    })
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/api && pnpm test settings.test 2>&1 | tail -30
```

Expected: FAIL — removed routes still return 200, cli.cmd still present

- [ ] **Step 3: Update settings.ts**

**3a. Remove import and dead state at top of `settingsRoutes`:**

Remove from `apps/api/src/routes/settings.ts` line 3:
```ts
import { execFileSync } from 'node:child_process'
```

**3b. Replace `GET /settings` handler** (lines 32–68) with:

```ts
fastify.get('/settings', { preHandler }, async () => {
  const token = (await readStoredToken(fastify.redis)) ?? env.GITHUB_TOKEN ?? null
  let user: { login: string; avatarUrl?: string } | null = null
  if (token) {
    try {
      const oct = new Octokit({ auth: token })
      const { data } = await oct.users.getAuthenticated()
      user = { login: data.login, avatarUrl: data.avatar_url }
    } catch {
      user = null
    }
  }

  const reposBaseDir = (await fastify.redis.get('settings:repos:base-dir')) ?? null

  return {
    github: {
      connected: !!user,
      tokenPreview: maskToken(token),
      oauthEnabled: !!env.GITHUB_OAUTH_CLIENT_ID,
      user,
    },
    cli: {
      orchestratorUrl: env.ORCHESTRATOR_URL,
    },
    reposBaseDir,
  }
})
```

**3c. Remove `POST /settings/claude/cmd`** (lines 70–75) entirely.

**3d. Remove `DELETE /settings/claude/cmd`** (lines 77–80) entirely.

**3e. Replace `GET /settings/claude/test`** (lines 94–107) with:

```ts
fastify.get('/settings/claude/test', { preHandler }, async (_, reply) => {
  try {
    const res = await fetch(`${env.ORCHESTRATOR_URL}/health/claude`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return reply.status(502).send({ ok: false, error: 'Orchestrator error', cmd: 'unknown' })
    }
    return res.json()
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Orchestrator unreachable', cmd: 'unknown' }
  }
})
```

**3f. Replace `POST /settings/cli/claude/token`** (lines 285–296) with:

```ts
fastify.post('/settings/cli/claude/token', { preHandler }, async (request, reply) => {
  const { token } = claudeTokenSchema.parse(request.body)
  try {
    const res = await fetch(`${env.ORCHESTRATOR_URL}/health/claude/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      return reply.status(502).send({ error: body.error ?? 'Orchestrator error' })
    }
    await logAudit(fastify, request, { action: 'settings.cli.claude.token.saved' })
    return res.json()
  } catch (e: any) {
    return reply.status(502).send({ error: e?.message ?? 'Orchestrator unreachable' })
  }
})
```

Also remove `writeFileSync`, `mkdirSync`, `dirname` imports (lines 4–5) since they're no longer used.

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/api && pnpm test settings.test 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 5: Typecheck**

```bash
cd apps/api && pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/settings.ts apps/api/src/__tests__/settings.test.ts
git commit -m "feat(api): proxy claude test and token to orchestrator, remove cmd override routes"
```

---

### Task 4: Frontend — remove cmd override UI

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Remove saveCliCmd and resetCliCmd from api.ts**

In `apps/web/lib/api.ts`, find and remove these two methods (around lines 166–172):

```ts
// Remove:
saveCliCmd: (cmd: string) =>
  request<{ ok: boolean }>('/settings/claude/cmd', {
    method: 'POST',
    body: JSON.stringify({ cmd }),
  }),
resetCliCmd: () =>
  request<{ ok: boolean }>('/settings/claude/cmd', { method: 'DELETE' }),
```

- [ ] **Step 2: Remove dead state and handler functions from settings/page.tsx**

In `apps/web/app/settings/page.tsx`, remove:

**State variables** (lines 87–94, the cmd override ones):
```ts
// Remove:
const [cliCmd, setCliCmd] = useState('claude')
const [cliCmdInput, setCliCmdInput] = useState('')
const [cliSource, setCliSource] = useState('default')
const [cliSaving, setCliSaving] = useState(false)
const [cliInfo, setCliInfo] = useState('')
const [cliError, setCliError] = useState('')
```

Keep: `cliTesting`, `cliTestResult`.

**In `refresh()`**, remove lines that reference these deleted state setters:
```ts
// Remove:
setCliCmd(s.cli?.cmd ?? 'claude')
setCliSource(s.cli?.source ?? 'default')
```

**Remove handler functions** `saveCliCmd` (lines 178–189) and `resetCliCmd` (lines 191–196).

- [ ] **Step 3: Update the Claude CLI tab JSX**

Replace the entire Claude CLI tab section (lines 283–388, `{activeTab === 'cli' && ...}`) with:

```tsx
{activeTab === 'cli' && (
  <section className="bg-surface border border-border rounded-lg p-5">
    <div className="mb-4">
      <h2 className="text-[14px] font-semibold text-text">Claude CLI</h2>
      <p className="text-[13px] text-muted mt-0.5">สถานะ claude binary ใน orchestrator container</p>
    </div>

    <div className="mb-4">
      <button
        onClick={testCli}
        disabled={cliTesting}
        className="text-[13px] bg-surface-2 hover:bg-canvas border border-border text-text px-4 py-2 rounded transition-colors disabled:opacity-40"
      >
        {cliTesting ? '…' : '▶ ทดสอบ CLI'}
      </button>
      {cliTestResult && (
        <div className={`mt-2 p-3 rounded border text-[12px] font-mono ${
          cliTestResult.ok
            ? 'bg-success/5 border-success/20 text-success'
            : 'bg-danger/5 border-danger/20 text-danger'
        }`}>
          {cliTestResult.ok
            ? `${cliTestResult.version}  (${cliTestResult.cmd})`
            : cliTestResult.error}
        </div>
      )}
    </div>

    <p className="text-[12px] text-dim mt-2">
      เปลี่ยน binary ได้โดยตั้ง <code className="font-mono text-muted">CLAUDE_CMD</code> ใน orchestrator environment แล้ว restart
    </p>

    {/* Repos Base Directory */}
    <div className="pt-4 border-t border-border mt-4">
      <h3 className="text-[13px] font-semibold text-text mb-0.5">Repos Base Directory</h3>
      <p className="text-[12px] text-dim mb-3">
        root directory ที่ clone repos ไว้ — ใช้ auto-fill path เมื่อสร้าง project เช่น <span className="font-mono text-muted">/home/ubuntu/repos</span>
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={reposBaseDir}
          onChange={e => setReposBaseDir(e.target.value)}
          placeholder="/home/ubuntu/repos"
          className="flex-1 bg-canvas border border-border text-text text-[13px] rounded px-3 py-1.5 placeholder-dim font-mono"
        />
        <button
          type="button"
          onClick={saveBaseDir}
          disabled={savingBaseDir}
          className="text-[13px] bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent px-3 py-1.5 rounded transition-all disabled:opacity-50"
        >
          {savingBaseDir ? '…' : 'Save'}
        </button>
        {savedBaseDir && (
          <button
            type="button"
            onClick={async () => { await api.settings.resetReposBaseDir(); setSavedBaseDir(null); setReposBaseDir('') }}
            className="text-[13px] text-muted hover:text-danger px-2 py-1.5 rounded transition-colors"
          >
            ✕
          </button>
        )}
      </div>
      {savedBaseDir && (
        <p className="text-[12px] text-success mt-1.5">✓ {savedBaseDir}</p>
      )}
    </div>
  </section>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```

Expected: no errors (no references to removed functions)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/app/settings/page.tsx
git commit -m "feat(web): remove CLI cmd override UI, show orchestrator version in test result"
```

---

### Task 5: Verify full stack in Docker

- [ ] **Step 1: Rebuild and start containers**

```bash
docker compose down && docker compose build orchestrator api && docker compose up -d
```

- [ ] **Step 2: Check orchestrator health**

```bash
curl -s http://localhost:4802/health/claude | jq .
```

Expected:
```json
{ "ok": true, "version": "...", "cmd": "/usr/local/bin/claude" }
```

- [ ] **Step 3: Test via settings UI**

Open `http://localhost:4800/settings` → Claude CLI tab → click **ทดสอบ CLI**

Expected: green banner with claude version string

- [ ] **Step 4: Send a chat message**

Open the chat page, send a message. Verify:
- Lead responds (no ENOENT error in API logs)
- API logs show no `spawnSync` or `execFile` calls

```bash
docker compose logs api --tail=50
```

Expected: no `ENOENT` errors, requests complete successfully

- [ ] **Step 5: Commit if any last fixes made, then tag**

```bash
git log --oneline -5
```

# MeshAgent — Plan 2: Orchestration Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง orchestration service ที่ spawn Claude Code CLI เป็น subprocess ต่อ agent session, stream output ผ่าน Redis pub/sub, และ expose HTTP API ให้ `apps/api` เรียกใช้

**Architecture:** `packages/orchestrator` เป็น standalone Node.js service มี `SessionManager` จัดการ lifecycle ของแต่ละ agent session (spawn subprocess → pipe stdout → Redis), `TaskQueue` รับงานจาก API และ dispatch ให้ session, HTTP API (Fastify) บน port 3002 สำหรับ internal communication กับ `apps/api`

**Tech Stack:** Node.js 20, TypeScript 5, Fastify 4, ioredis 5, BullMQ 5, child_process (built-in), Vitest 1

**Prerequisite:** Plan 1 เสร็จแล้ว (Docker Compose รัน, shared package พร้อม)

---

## File Map

```
packages/orchestrator/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts            ← entry: start HTTP server
    ├── server.ts           ← buildServer() factory
    ├── env.ts              ← env validation
    ├── session.ts          ← AgentSession class
    ├── manager.ts          ← SessionManager (singleton)
    ├── streamer.ts         ← stdout line → Redis PUBLISH
    ├── queue.ts            ← BullMQ task queue
    ├── routes/
    │   └── sessions.ts     ← POST /sessions, DELETE /sessions/:id, GET /sessions
    └── __tests__/
        ├── session.test.ts
        └── manager.test.ts
```

---

## Task 1: Package Setup

**Files:**
- Create: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/tsconfig.json`
- Create: `packages/orchestrator/src/env.ts`

- [ ] **Step 1: Create `packages/orchestrator/package.json`**

```json
{
  "name": "@meshagent/orchestrator",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@meshagent/shared": "workspace:*",
    "bullmq": "^5.7.0",
    "fastify": "^4.27.0",
    "fastify-plugin": "^4.5.1",
    "ioredis": "^5.3.2",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/orchestrator/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/orchestrator/src/env.ts`**

```typescript
import { z } from 'zod'

const envSchema = z.object({
  REDIS_URL: z.string().url(),
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLAUDE_CMD: z.string().default('claude'),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 4: Install deps**

```bash
cd packages/orchestrator && pnpm install
```

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/
git commit -m "chore(orchestrator): initialize package"
```

---

## Task 2: AgentSession — Test First

**Files:**
- Create: `packages/orchestrator/src/session.ts`
- Create: `packages/orchestrator/src/__tests__/session.test.ts`
- Create: `packages/orchestrator/vitest.config.ts`

- [ ] **Step 1: Create `packages/orchestrator/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

- [ ] **Step 2: Write failing tests**

Create `packages/orchestrator/src/__tests__/session.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentSession } from '../session.js'

describe('AgentSession', () => {
  it('has idle status on creation', () => {
    const session = new AgentSession({
      id: 'test-1',
      role: 'frontend',
      workingDir: '/tmp',
      claudeCmd: 'echo',
    })
    expect(session.status).toBe('idle')
    expect(session.id).toBe('test-1')
    expect(session.role).toBe('frontend')
  })

  it('transitions to running when started', async () => {
    const session = new AgentSession({
      id: 'test-2',
      role: 'backend',
      workingDir: '/tmp',
      claudeCmd: 'echo',
    })
    const onOutput = vi.fn()
    // echo "hello" จะ exit ทันที
    await session.start('hello', onOutput)
    expect(session.status).toBe('idle')
  })

  it('calls onOutput with stdout lines', async () => {
    const session = new AgentSession({
      id: 'test-3',
      role: 'qa',
      workingDir: '/tmp',
      claudeCmd: 'echo',
    })
    const lines: string[] = []
    await session.start('test output', (line) => lines.push(line))
    expect(lines.length).toBeGreaterThan(0)
  })

  it('stop() terminates running process', async () => {
    const session = new AgentSession({
      id: 'test-4',
      role: 'frontend',
      workingDir: '/tmp',
      claudeCmd: 'sleep',
    })
    session.start('10', () => {})
    await new Promise((r) => setTimeout(r, 50))
    session.stop()
    expect(session.status).toBe('idle')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/orchestrator && pnpm test
```

Expected: FAIL — "Cannot find module '../session.js'"

- [ ] **Step 4: Create `packages/orchestrator/src/session.ts`**

```typescript
import { spawn, ChildProcess } from 'node:child_process'
import type { AgentRole, AgentStatus } from '@meshagent/shared'

interface SessionOptions {
  id: string
  role: AgentRole
  workingDir: string
  claudeCmd: string
}

export class AgentSession {
  readonly id: string
  readonly role: AgentRole
  private _status: AgentStatus = 'idle'
  private process: ChildProcess | null = null
  private readonly workingDir: string
  private readonly claudeCmd: string

  constructor(opts: SessionOptions) {
    this.id = opts.id
    this.role = opts.role
    this.workingDir = opts.workingDir
    this.claudeCmd = opts.claudeCmd
  }

  get status(): AgentStatus {
    return this._status
  }

  start(prompt: string, onOutput: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this._status = 'running'

      this.process = spawn(this.claudeCmd, [prompt], {
        cwd: this.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const handleLine = (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean)
        lines.forEach(onOutput)
      }

      this.process.stdout?.on('data', handleLine)
      this.process.stderr?.on('data', handleLine)

      this.process.on('close', () => {
        this._status = 'idle'
        this.process = null
        resolve()
      })

      this.process.on('error', (err) => {
        this._status = 'error'
        this.process = null
        reject(err)
      })
    })
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM')
      this._status = 'idle'
      this.process = null
    }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/orchestrator && pnpm test
```

Expected: PASS — 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/session.ts packages/orchestrator/src/__tests__/session.test.ts packages/orchestrator/vitest.config.ts
git commit -m "feat(orchestrator): add AgentSession with subprocess management"
```

---

## Task 3: SessionManager — Test First

**Files:**
- Create: `packages/orchestrator/src/manager.ts`
- Create: `packages/orchestrator/src/__tests__/manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/orchestrator/src/__tests__/manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { SessionManager } from '../manager.js'

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager({ claudeCmd: 'echo' })
  })

  it('starts empty', () => {
    expect(manager.listSessions()).toEqual([])
  })

  it('creates a session and returns it', () => {
    const session = manager.createSession({
      role: 'frontend',
      workingDir: '/tmp',
    })
    expect(session.role).toBe('frontend')
    expect(session.status).toBe('idle')
    expect(manager.listSessions()).toHaveLength(1)
  })

  it('getSession returns session by id', () => {
    const session = manager.createSession({ role: 'backend', workingDir: '/tmp' })
    expect(manager.getSession(session.id)).toBe(session)
  })

  it('getSession returns undefined for unknown id', () => {
    expect(manager.getSession('nonexistent')).toBeUndefined()
  })

  it('removeSession stops and removes session', () => {
    const session = manager.createSession({ role: 'qa', workingDir: '/tmp' })
    manager.removeSession(session.id)
    expect(manager.listSessions()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/orchestrator && pnpm test
```

Expected: FAIL — "Cannot find module '../manager.js'"

- [ ] **Step 3: Create `packages/orchestrator/src/manager.ts`**

```typescript
import { AgentSession } from './session.js'
import type { AgentRole } from '@meshagent/shared'

interface CreateSessionOpts {
  role: AgentRole
  workingDir: string
}

interface ManagerOptions {
  claudeCmd: string
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>()
  private readonly claudeCmd: string

  constructor(opts: ManagerOptions) {
    this.claudeCmd = opts.claudeCmd
  }

  createSession(opts: CreateSessionOpts): AgentSession {
    const session = new AgentSession({
      id: crypto.randomUUID(),
      role: opts.role,
      workingDir: opts.workingDir,
      claudeCmd: this.claudeCmd,
    })
    this.sessions.set(session.id, session)
    return session
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id)
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  removeSession(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.stop()
      this.sessions.delete(id)
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/orchestrator && pnpm test
```

Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/manager.ts packages/orchestrator/src/__tests__/manager.test.ts
git commit -m "feat(orchestrator): add SessionManager"
```

---

## Task 4: Redis Streamer

**Files:**
- Create: `packages/orchestrator/src/streamer.ts`

- [ ] **Step 1: Create `packages/orchestrator/src/streamer.ts`**

```typescript
import Redis from 'ioredis'

export class Streamer {
  private publisher: Redis

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl)
  }

  publishLine(sessionId: string, line: string): void {
    this.publisher.publish(
      `agent:${sessionId}:output`,
      JSON.stringify({ line, timestamp: Date.now() }),
    )
  }

  async close(): Promise<void> {
    this.publisher.disconnect()
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/streamer.ts
git commit -m "feat(orchestrator): add Redis streamer for agent output"
```

---

## Task 5: HTTP API + Entry Point

**Files:**
- Create: `packages/orchestrator/src/routes/sessions.ts`
- Create: `packages/orchestrator/src/server.ts`
- Create: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Create `packages/orchestrator/src/routes/sessions.ts`**

```typescript
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { SessionManager } from '../manager.js'
import type { Streamer } from '../streamer.js'
import type { AgentRole } from '@meshagent/shared'

const createSessionSchema = z.object({
  role: z.enum(['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer']),
  workingDir: z.string(),
  prompt: z.string(),
})

export async function sessionRoutes(
  fastify: FastifyInstance,
  opts: { manager: SessionManager; streamer: Streamer },
) {
  const { manager, streamer } = opts

  // POST /sessions — สร้าง session และเริ่ม prompt ทันที
  fastify.post('/sessions', async (request, reply) => {
    const body = createSessionSchema.parse(request.body)
    const session = manager.createSession({
      role: body.role as AgentRole,
      workingDir: body.workingDir,
    })

    // start แบบ non-blocking
    session
      .start(body.prompt, (line) => streamer.publishLine(session.id, line))
      .catch((err) => fastify.log.error({ sessionId: session.id, err }, 'session error'))

    reply.status(201)
    return { id: session.id, role: session.role, status: session.status }
  })

  // GET /sessions — list all sessions
  fastify.get('/sessions', async () => {
    return manager.listSessions().map((s) => ({
      id: s.id,
      role: s.role,
      status: s.status,
    }))
  })

  // DELETE /sessions/:id — stop session
  fastify.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!manager.getSession(id)) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    manager.removeSession(id)
    reply.status(204)
  })
}
```

- [ ] **Step 2: Create `packages/orchestrator/src/server.ts`**

```typescript
import Fastify from 'fastify'
import { env } from './env.js'
import { SessionManager } from './manager.js'
import { Streamer } from './streamer.js'
import { sessionRoutes } from './routes/sessions.js'

export async function buildServer() {
  const fastify = Fastify({ logger: env.NODE_ENV !== 'test' })

  const manager = new SessionManager({ claudeCmd: env.CLAUDE_CMD })
  const streamer = new Streamer(env.REDIS_URL)

  fastify.get('/health', async () => ({ status: 'ok' }))
  await fastify.register(sessionRoutes, { manager, streamer })

  fastify.addHook('onClose', async () => { await streamer.close() })

  return fastify
}
```

- [ ] **Step 3: Create `packages/orchestrator/src/index.ts`**

```typescript
import { buildServer } from './server.js'
import { env } from './env.js'

const server = await buildServer()

try {
  await server.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  server.log.error(err)
  process.exit(1)
}
```

- [ ] **Step 4: Add orchestrator to `docker-compose.yml`**

เพิ่ม service ใน `docker-compose.yml`:

```yaml
  orchestrator:
    build:
      context: .
      dockerfile: packages/orchestrator/Dockerfile.dev
    environment:
      REDIS_URL: redis://redis:6379
      PORT: 3002
      CLAUDE_CMD: claude
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    volumes:
      - ./packages/orchestrator:/app/packages/orchestrator
      - ./packages/shared:/app/packages/shared
      - ~/.claude:/root/.claude:ro
    ports:
      - "3002:3002"
    depends_on:
      redis:
        condition: service_healthy
```

- [ ] **Step 5: Create `packages/orchestrator/Dockerfile.dev`**

```dockerfile
FROM node:20-alpine
RUN npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
RUN pnpm install
CMD ["pnpm", "--filter", "@meshagent/orchestrator", "dev"]
```

- [ ] **Step 6: Smoke test**

```bash
# Start services
ANTHROPIC_API_KEY=your-key docker compose up -d

# Test health
curl http://localhost:3002/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/ docker-compose.yml
git commit -m "feat(orchestrator): add HTTP API and entry point"
```

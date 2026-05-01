# Local Companion Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `mesh-companion` CLI daemon and WebSocket tunnel infrastructure that lets a local developer machine connect to a MeshAgent server, exposing `fs.list` and `fs.stat` over JSON-RPC.

**Architecture:** A new `packages/companion` CLI package connects to `wss://server/ws/companion` using a bearer token generated from Settings. The server routes JSON-RPC requests through an in-memory `CompanionManager` to the connected companion daemon, which handles `fs.list` and `fs.stat` requests on the local filesystem.

**Tech Stack:** Node.js, TypeScript, `@fastify/websocket` (server), `ws` npm package (companion client), `commander` (CLI), `bcryptjs` (token hashing), Drizzle ORM, Zod, Vitest

---

## File Map

| File                                       | Action | Responsibility                             |
| ------------------------------------------ | ------ | ------------------------------------------ |
| `packages/shared/src/schema.ts`            | Modify | Add `companionTokens` table                |
| `apps/api/src/routes/companion.ts`         | Create | Token CRUD + WS upgrade endpoint           |
| `apps/api/src/lib/companionManager.ts`     | Create | In-memory WS connection registry           |
| `apps/api/src/ws/companionWs.ts`           | Create | JSON-RPC router (server side)              |
| `apps/api/src/server.ts`                   | Modify | Register companion routes                  |
| `apps/api/src/__tests__/companion.test.ts` | Create | Token CRUD + status API tests              |
| `apps/web/lib/api.ts`                      | Modify | Add `companion.*` API methods              |
| `apps/web/app/settings/page.tsx`           | Modify | Add Companion tab                          |
| `packages/companion/package.json`          | Create | npm package config, `mesh-companion` bin   |
| `packages/companion/tsconfig.json`         | Create | TypeScript config                          |
| `packages/companion/src/cli.ts`            | Create | CLI entry point (`mesh-companion connect`) |
| `packages/companion/src/client.ts`         | Create | WS client with reconnect + ping            |
| `packages/companion/src/handlers/fs.ts`    | Create | `fs.list` and `fs.stat` handlers           |
| `packages/companion/src/index.ts`          | Create | Re-exports                                 |

---

## Task 1: companionTokens DB Schema

**Files:**

- Modify: `packages/shared/src/schema.ts`

- [ ] **Step 1: Add the companionTokens table to schema.ts**

Open `packages/shared/src/schema.ts`. Find the last table definition and add after it:

```typescript
export const companionTokens = pgTable('companion_tokens', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull().default('default'),
  tokenHash: text('token_hash').notNull(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at'),
});
```

Also add to `packages/shared/src/index.ts` (export the new table):

```typescript
export { companionTokens } from './schema.js';
```

- [ ] **Step 2: Generate migration**

Run from `packages/shared/`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/meshagent pnpm db:generate
```

Expected: new file created in `packages/shared/drizzle/` with `CREATE TABLE companion_tokens`

- [ ] **Step 3: Apply migration**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/meshagent pnpm db:migrate
```

Expected: `companion_tokens table created`

- [ ] **Step 4: Typecheck**

```bash
cd packages/shared && pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schema.ts packages/shared/src/index.ts packages/shared/drizzle/
git commit -m "feat(schema): add companionTokens table"
```

---

## Task 2: CompanionManager

**Files:**

- Create: `apps/api/src/lib/companionManager.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { WebSocket } from '@fastify/websocket';

interface CompanionConnection {
  tokenId: string;
  userId: string;
  ws: WebSocket;
  connectedAt: Date;
}

class CompanionManager {
  private connections = new Map<string, CompanionConnection>();
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  register(tokenId: string, userId: string, ws: WebSocket): void {
    this.connections.set(tokenId, { tokenId, userId, ws, connectedAt: new Date() });
  }

  unregister(tokenId: string): void {
    this.connections.delete(tokenId);
    // reject all pending requests for this companion
    for (const [id, pending] of this.pendingRequests) {
      if (id.startsWith(tokenId + ':')) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Companion disconnected'));
        this.pendingRequests.delete(id);
      }
    }
  }

  isConnected(userId: string): boolean {
    for (const conn of this.connections.values()) {
      if (conn.userId === userId) return true;
    }
    return false;
  }

  getConnection(userId: string): CompanionConnection | undefined {
    for (const conn of this.connections.values()) {
      if (conn.userId === userId) return conn;
    }
    return undefined;
  }

  async call<T>(userId: string, method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    const conn = this.getConnection(userId);
    if (!conn) throw new Error('No companion connected for this user');

    const id = `${conn.tokenId}:${crypto.randomUUID()}`;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Companion RPC timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      conn.ws.send(msg);
    });
  }

  handleResponse(data: string): void {
    let msg: { id?: string; result?: unknown; error?: { message: string } };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (!msg.id) return;
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.id);

    if (msg.error) pending.reject(new Error(msg.error.message));
    else pending.resolve(msg.result);
  }
}

export const companionManager = new CompanionManager();
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/api && pnpm tsc --noEmit
```

Expected: no errors in `companionManager.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/companionManager.ts
git commit -m "feat(api): add CompanionManager for WS connection registry"
```

---

## Task 3: Companion Token API Routes + WS Endpoint

**Files:**

- Create: `apps/api/src/routes/companion.ts`

- [ ] **Step 1: Write the failing tests first**

Create `apps/api/src/__tests__/companion.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { buildServer } from '../server.js';

describe('Companion token routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let adminToken: string;

  beforeAll(async () => {
    server = await buildServer();
    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@example.com', password: 'changeme123' },
    });
    adminToken = res.json().token;
  });

  afterAll(async () => {
    await server.close();
  });

  it('POST /companion/tokens creates a token and returns plaintext once', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/companion/tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { label: 'my-laptop' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^mesh_comp_/);
    expect(body.id).toBeTruthy();
    expect(body.prefix).toBeTruthy();
  });

  it('GET /companion/tokens lists tokens (no plaintext)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/companion/tokens',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).not.toHaveProperty('tokenHash');
    expect(list[0]).not.toHaveProperty('token');
  });

  it('DELETE /companion/tokens/:id revokes token', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/companion/tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { label: 'to-delete' },
    });
    const { id } = create.json();

    const del = await server.inject({
      method: 'DELETE',
      url: `/companion/tokens/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(200);
  });

  it('GET /companion/status returns connected: false when no companion', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/companion/status',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().connected).toBe(false);
  });

  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/companion/tokens' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && pnpm test src/__tests__/companion.test.ts
```

Expected: FAIL — route not found (404)

- [ ] **Step 3: Create the route file**

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { companionTokens } from '@meshagent/shared';
import { companionManager } from '../lib/companionManager.js';

const SALT_ROUNDS = 10;

function generateToken(): { token: string; prefix: string; hash: string } {
  const raw = `mesh_comp_${crypto.randomBytes(16).toString('hex')}`;
  const prefix = raw.slice(0, 20);
  const hash = bcrypt.hashSync(raw, SALT_ROUNDS);
  return { token: raw, prefix, hash };
}

export async function companionRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate];

  // List tokens for current user (no plaintext)
  fastify.get('/companion/tokens', { preHandler }, async (request) => {
    const { id: userId } = request.user as { id: string };
    const rows = await fastify.db
      .select({
        id: companionTokens.id,
        label: companionTokens.label,
        prefix: companionTokens.prefix,
        createdAt: companionTokens.createdAt,
        lastSeenAt: companionTokens.lastSeenAt,
      })
      .from(companionTokens)
      .where(eq(companionTokens.userId, userId));
    return rows;
  });

  // Create token — returns plaintext once
  fastify.post('/companion/tokens', { preHandler }, async (request, reply) => {
    const { id: userId } = request.user as { id: string };
    const { label } = z
      .object({ label: z.string().min(1).max(100).default('default') })
      .parse(request.body);
    const { token, prefix, hash } = generateToken();
    const [row] = await fastify.db
      .insert(companionTokens)
      .values({ userId, label, tokenHash: hash, prefix })
      .returning({ id: companionTokens.id, prefix: companionTokens.prefix });
    return reply.status(201).send({ id: row.id, prefix: row.prefix, token });
  });

  // Revoke token
  fastify.delete('/companion/tokens/:id', { preHandler }, async (request, reply) => {
    const { id: userId } = request.user as { id: string };
    const { id } = request.params as { id: string };
    await fastify.db
      .delete(companionTokens)
      .where(and(eq(companionTokens.id, id), eq(companionTokens.userId, userId)));
    return reply.send({ ok: true });
  });

  // Connection status
  fastify.get('/companion/status', { preHandler }, async (request) => {
    const { id: userId } = request.user as { id: string };
    const conn = companionManager.getConnection(userId);
    return {
      connected: !!conn,
      connectedAt: conn?.connectedAt ?? null,
    };
  });

  // WebSocket endpoint for companion daemon
  fastify.get('/ws/companion', { websocket: true }, async (socket, request) => {
    // Authenticate via Authorization: Bearer <token>
    const authHeader = (request.headers['authorization'] as string | undefined) ?? '';
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!rawToken.startsWith('mesh_comp_')) {
      socket.send(JSON.stringify({ error: 'Unauthorized' }));
      socket.close(1008, 'Unauthorized');
      return;
    }

    // Find matching token in DB
    const rows = await fastify.db.select().from(companionTokens);
    const match = rows.find((r) => bcrypt.compareSync(rawToken, r.tokenHash));

    if (!match) {
      socket.send(JSON.stringify({ error: 'Unauthorized' }));
      socket.close(1008, 'Unauthorized');
      return;
    }

    // Register connection
    companionManager.register(match.id, match.userId, socket);
    await fastify.db
      .update(companionTokens)
      .set({ lastSeenAt: new Date() })
      .where(eq(companionTokens.id, match.id));

    // Notify browser via Redis
    await fastify.redis.publish(
      'companion:events',
      JSON.stringify({ type: 'companion.connected', userId: match.userId }),
    );

    socket.on('message', (raw: Buffer) => {
      companionManager.handleResponse(raw.toString());
      // Update lastSeenAt on ping
      fastify.db
        .update(companionTokens)
        .set({ lastSeenAt: new Date() })
        .where(eq(companionTokens.id, match.id))
        .catch(() => {});
    });

    socket.on('close', async () => {
      companionManager.unregister(match.id);
      await fastify.redis.publish(
        'companion:events',
        JSON.stringify({ type: 'companion.disconnected', userId: match.userId }),
      );
    });
  });
}
```

**Note:** `crypto.randomBytes` requires `import crypto from 'node:crypto'` at the top of the file. Add it.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && pnpm test src/__tests__/companion.test.ts
```

Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/companion.ts apps/api/src/__tests__/companion.test.ts
git commit -m "feat(api): add companion token CRUD and WS endpoint"
```

---

## Task 4: Register Companion Routes in server.ts

**Files:**

- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Add import and register**

Find the imports at the top of `apps/api/src/server.ts` and add:

```typescript
import { companionRoutes } from './routes/companion.js';
```

Find where other routes are registered (e.g. `await fastify.register(agentRoutes)`) and add after it:

```typescript
await fastify.register(companionRoutes);
```

- [ ] **Step 2: Typecheck + run all API tests**

```bash
cd apps/api && pnpm tsc --noEmit && pnpm test
```

Expected: all tests pass, no type errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): register companion routes in server"
```

---

## Task 5: packages/companion Setup

**Files:**

- Create: `packages/companion/package.json`
- Create: `packages/companion/tsconfig.json`
- Create: `packages/companion/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@meshagent/companion",
  "version": "0.1.0",
  "description": "MeshAgent local companion daemon",
  "type": "module",
  "bin": {
    "mesh-companion": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create src/index.ts**

```typescript
export { CompanionClient } from './client.js';
```

- [ ] **Step 4: Install dependencies**

```bash
cd packages/companion && pnpm install
```

Expected: `node_modules` created with `commander`, `ws`, `@types/ws`

- [ ] **Step 5: Commit**

```bash
git add packages/companion/
git commit -m "feat(companion): scaffold companion package"
```

---

## Task 6: fs Handlers

**Files:**

- Create: `packages/companion/src/handlers/fs.ts`

- [ ] **Step 1: Create the file**

```typescript
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface FsListParams {
  path: string;
}
export interface FsListResult {
  entries: { name: string; type: 'dir' | 'file'; size?: number }[];
}

export interface FsStatParams {
  path: string;
}
export interface FsStatResult {
  exists: boolean;
  readable: boolean;
  type: 'dir' | 'file' | null;
}

function safePath(p: string): string {
  if (p.includes('..')) throw new Error('Path traversal not allowed');
  return path.resolve(p);
}

export async function fsList(params: FsListParams): Promise<FsListResult> {
  const resolved = safePath(params.path);
  const entries = await readdir(resolved, { withFileTypes: true });
  return {
    entries: entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
  };
}

export async function fsStat(params: FsStatParams): Promise<FsStatResult> {
  const resolved = safePath(params.path);
  try {
    const s = await stat(resolved);
    return { exists: true, readable: true, type: s.isDirectory() ? 'dir' : 'file' };
  } catch (e: any) {
    if (e.code === 'ENOENT') return { exists: false, readable: false, type: null };
    if (e.code === 'EACCES') return { exists: true, readable: false, type: null };
    throw e;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/companion && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/companion/src/handlers/fs.ts
git commit -m "feat(companion): add fs.list and fs.stat handlers"
```

---

## Task 7: Companion WS Client

**Files:**

- Create: `packages/companion/src/client.ts`

- [ ] **Step 1: Create the file**

```typescript
import WebSocket from 'ws';
import { fsList, fsStat } from './handlers/fs.js';

interface RpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}
interface RpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

const PING_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

const HANDLERS: Record<string, (params: any) => Promise<unknown>> = {
  'fs.list': fsList,
  'fs.stat': fsStat,
  'companion.ping': async () => ({}),
};

export interface CompanionClientOptions {
  url: string;
  token: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class CompanionClient {
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private opts: CompanionClientOptions) {}

  connect(): void {
    if (this.stopped) return;
    const wsUrl = this.opts.url.replace(/^http/, 'ws') + '/ws/companion';

    this.ws = new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${this.opts.token}` },
    });

    this.ws.on('open', () => {
      console.log('✓ Connected to MeshAgent');
      this.opts.onConnected?.();
      this.pingTimer = setInterval(() => {
        this.ws?.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'companion.ping',
            params: {},
          }),
        );
      }, PING_INTERVAL_MS);
    });

    this.ws.on('message', async (raw: Buffer) => {
      let req: RpcRequest;
      try {
        req = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!req.id || !req.method) return;

      const handler = HANDLERS[req.method];
      if (!handler) {
        this.send({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        });
        return;
      }

      try {
        const result = await handler(req.params ?? {});
        this.send({ jsonrpc: '2.0', id: req.id, result });
      } catch (err: any) {
        this.send({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: err.message ?? 'Internal error' },
        });
      }
    });

    this.ws.on('close', () => {
      this.clearPing();
      this.opts.onDisconnected?.();
      if (!this.stopped) {
        console.log(`Disconnected. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });

    this.ws.on('error', (err) => {
      console.error('Connection error:', err.message);
    });
  }

  stop(): void {
    this.stopped = true;
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private send(msg: RpcResponse): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/companion && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/companion/src/client.ts
git commit -m "feat(companion): add WS client with reconnect and JSON-RPC dispatch"
```

---

## Task 8: Companion CLI Entry Point

**Files:**

- Create: `packages/companion/src/cli.ts`

- [ ] **Step 1: Create the file**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { CompanionClient } from './client.js';

const program = new Command();

program.name('mesh-companion').description('MeshAgent local companion daemon').version('0.1.0');

program
  .command('connect <url>')
  .description('Connect this machine to a MeshAgent server')
  .requiredOption('--token <token>', 'Companion token from MeshAgent Settings → Companion tab')
  .action((url: string, opts: { token: string }) => {
    if (!opts.token.startsWith('mesh_comp_')) {
      console.error('✕ Invalid token format. Token must start with mesh_comp_');
      process.exit(1);
    }

    console.log(`Connecting to ${url}...`);
    console.log('  Serving: fs.list, fs.stat');
    console.log('  Press Ctrl+C to disconnect.\n');

    const client = new CompanionClient({
      url,
      token: opts.token,
      onConnected: () => console.log('✓ Companion ready\n'),
      onDisconnected: () => console.log('Disconnected.'),
    });

    client.connect();

    process.on('SIGINT', () => {
      console.log('\nDisconnecting...');
      client.stop();
      process.exit(0);
    });
  });

program.parse();
```

- [ ] **Step 2: Build and test locally**

```bash
cd packages/companion && pnpm build
```

Expected: `dist/` directory created with compiled JS files

```bash
node dist/cli.js --help
```

Expected:

```
Usage: mesh-companion [options] [command]
...
Commands:
  connect [options] <url>   Connect this machine to a MeshAgent server
```

- [ ] **Step 3: Commit**

```bash
git add packages/companion/src/cli.ts
git commit -m "feat(companion): add mesh-companion CLI entry point"
```

---

## Task 9: Frontend API Client Methods

**Files:**

- Modify: `apps/web/lib/api.ts`

- [ ] **Step 1: Add companion methods to api.ts**

Find the `export const api = {` object in `apps/web/lib/api.ts`. Add a new `companion` section:

```typescript
companion: {
  listTokens: () =>
    request<{ id: string; label: string; prefix: string; createdAt: string; lastSeenAt: string | null }[]>('/companion/tokens'),
  createToken: (label = 'default') =>
    request<{ id: string; prefix: string; token: string }>('/companion/tokens', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  revokeToken: (id: string) =>
    request<{ ok: boolean }>(`/companion/tokens/${id}`, { method: 'DELETE' }),
  status: () =>
    request<{ connected: boolean; connectedAt: string | null }>('/companion/status'),
},
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(web): add companion API client methods"
```

---

## Task 10: Settings UI — Companion Tab

**Files:**

- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Read current tab structure**

Open `apps/web/app/settings/page.tsx`. Find the `activeTab` state and the tab bar render. Current tabs: `'skills' | 'github' | 'providers'`.

- [ ] **Step 2: Add companion tab type and state**

Find:

```typescript
const [activeTab, setActiveTab] = useState<'skills' | 'github' | 'providers'>('providers');
```

Replace with:

```typescript
const [activeTab, setActiveTab] = useState<'skills' | 'github' | 'providers' | 'companion'>(
  'providers',
);
```

Add companion state variables near other state declarations:

```typescript
const [companionStatus, setCompanionStatus] = useState<{
  connected: boolean;
  connectedAt: string | null;
} | null>(null);
const [companionTokens, setCompanionTokens] = useState<
  { id: string; label: string; prefix: string; lastSeenAt: string | null }[]
>([]);
const [generatingToken, setGeneratingToken] = useState(false);
const [newToken, setNewToken] = useState<string | null>(null);
const [copiedToken, setCopiedToken] = useState(false);
```

- [ ] **Step 3: Add companion data fetch to the refresh function**

Find the `refresh` / `useEffect` that loads settings data. Add:

```typescript
const [compStatus, compTokens] = await Promise.all([
  api.companion.status().catch(() => null),
  api.companion.listTokens().catch(() => []),
]);
setCompanionStatus(compStatus);
setCompanionTokens(compTokens);
```

- [ ] **Step 4: Add tab button to the tab bar**

Find where tab buttons are rendered (look for `onClick={() => setActiveTab('providers')}` etc.). Add:

```tsx
<button
  onClick={() => setActiveTab('companion')}
  className={activeTab === 'companion' ? activeTabCls : tabCls}
>
  Companion
</button>
```

- [ ] **Step 5: Add Companion tab content panel**

Find the conditional rendering for tab content. Add after the last `{activeTab === 'skills' && ...}` block:

```tsx
{
  activeTab === 'companion' && (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[14px] font-semibold text-text">Local Companion</div>
            <div className="text-[12px] text-muted mt-0.5">
              Connect your local machine to run agents locally
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${companionStatus?.connected ? 'bg-success shadow-[0_0_6px_#3fb950]' : 'bg-dim'}`}
            />
            <span
              className={`text-[12px] ${companionStatus?.connected ? 'text-success' : 'text-dim'}`}
            >
              {companionStatus?.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
        </div>

        {/* Token section */}
        {companionTokens.length === 0 ? (
          <button
            onClick={async () => {
              setGeneratingToken(true);
              try {
                const res = await api.companion.createToken('default');
                setNewToken(res.token);
                const [status, tokens] = await Promise.all([
                  api.companion.status(),
                  api.companion.listTokens(),
                ]);
                setCompanionStatus(status);
                setCompanionTokens(tokens);
              } finally {
                setGeneratingToken(false);
              }
            }}
            disabled={generatingToken}
            className="w-full py-2 text-[13px] bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {generatingToken ? 'Generating...' : '+ Generate token'}
          </button>
        ) : (
          <div className="bg-surface-2 border border-border rounded-lg p-3 space-y-2">
            <div className="text-[11px] text-muted mb-1">Connection token</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[12px] text-text font-mono">
                {newToken ?? `${companionTokens[0].prefix}••••••••••`}
              </code>
              {newToken && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newToken);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 2000);
                  }}
                  className="text-[11px] text-accent hover:text-accent/80"
                >
                  {copiedToken ? 'Copied!' : 'Copy'}
                </button>
              )}
              <button
                onClick={async () => {
                  await api.companion.revokeToken(companionTokens[0].id);
                  setNewToken(null);
                  setCompanionTokens(await api.companion.listTokens());
                }}
                className="text-[11px] text-danger hover:text-danger/80"
              >
                Revoke
              </button>
            </div>
            {newToken && (
              <p className="text-[11px] text-warning">Save this token — it won't be shown again.</p>
            )}
          </div>
        )}
      </div>

      {/* Install instructions */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-[13px] font-semibold text-text mb-3">Install &amp; connect</div>
        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-[11px] text-success font-mono whitespace-pre overflow-x-auto">
          {`npm install -g @meshagent/companion
mesh-companion connect ${typeof window !== 'undefined' ? window.location.origin : 'https://your-server.com'} --token <your-token>`}
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Verify visually**

Start dev server: `pnpm dev` from project root. Open `http://localhost:4800`, login, go to Settings → Companion tab.

Verify:

- Companion tab appears in tab bar
- "Not connected" status shown (no daemon running)
- "Generate token" button works — shows token once with copy button
- After generating: shows masked token + Revoke button
- Revoke clears the token and shows Generate button again

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/settings/page.tsx
git commit -m "feat(web): add Companion tab to Settings with token management"
```

---

## Self-Review

### Spec Coverage

- [x] `companionTokens` table with userId, tokenHash, prefix, lastSeenAt → Task 1
- [x] `POST /companion/tokens` create, `GET` list, `DELETE` revoke → Task 3
- [x] `GET /companion/status` → Task 3
- [x] `GET /ws/companion` WS upgrade with Bearer token auth → Task 3
- [x] CompanionManager register/unregister/call/handleResponse → Task 2
- [x] Auto-reconnect (5s), ping (30s) in companion client → Task 7
- [x] `fs.list` and `fs.stat` with path traversal prevention → Task 6
- [x] Token format `mesh_comp_<32 hex>` → Task 3
- [x] Settings UI Companion tab with generate/copy/revoke → Task 10
- [x] Redis pub/sub `companion.connected` / `companion.disconnected` events → Task 3
- [x] Register routes in server.ts → Task 4

### Placeholder Scan

None found.

### Type Consistency

- `CompanionClient` exported from `client.ts`, imported in `cli.ts` ✓
- `fsList` / `fsStat` exported from `handlers/fs.ts`, imported in `client.ts` HANDLERS map ✓
- `companionTokens` table exported from `@meshagent/shared`, imported in `routes/companion.ts` ✓
- `companionManager` singleton from `lib/companionManager.ts`, imported in `routes/companion.ts` ✓
- `api.companion.*` methods match return types used in Settings UI ✓

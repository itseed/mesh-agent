# Local Companion — Tunnel & Daemon Design (Subsystem 1)

## Goal

Add a `mesh-companion` CLI daemon that runs on the developer's local machine and connects to the MeshAgent server via a JSON-RPC WebSocket tunnel. This is the infrastructure foundation for local folder browsing and local agent spawning.

## Decisions

| Decision         | Choice                                | Reason                                                                |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------- |
| Distribution     | `npm install -g @meshagent/companion` | No repo clone needed; Node.js already present on dev machines         |
| Development home | `packages/companion` in monorepo      | Share types via `@meshagent/shared`; publish to npm separately        |
| Protocol         | JSON-RPC 2.0 over WebSocket           | Standard, type-safe, extensible; single connection for all operations |
| Auth             | Companion token (hashed in DB)        | Separate from user JWT; revocable; copyable from Settings UI          |
| Transport        | `wss://server.com/ws/companion`       | Existing Fastify WS plugin; no new infra                              |

## Scope (Subsystem 1 only)

This spec covers the **tunnel + daemon infrastructure** only:

- Token management (CRUD)
- WebSocket connection lifecycle (connect, ping, reconnect, disconnect)
- JSON-RPC routing on both ends
- `fs.list` and `fs.stat` methods (enables folder browser in Subsystem 2)
- Settings UI: Companion tab with token generation + connection status

**Out of scope (Subsystem 2 and 3):**

- Folder browser UI component
- `agent.spawn`, `agent.stdout`, `agent.kill` methods (Subsystem 3)
- Project path selection via folder browser

## New Files

### Server (`apps/api/`)

| File                          | Responsibility                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/routes/companion.ts`     | `POST /companion/tokens` (create), `DELETE /companion/tokens/:id` (revoke), `GET /ws/companion` (WebSocket upgrade) |
| `src/lib/companionManager.ts` | In-memory registry of active companion WebSocket connections keyed by tokenId                                       |
| `src/ws/companionWs.ts`       | JSON-RPC message router — dispatches inbound responses, sends outbound requests                                     |

### Schema (`packages/shared/`)

| File            | Change                      |
| --------------- | --------------------------- |
| `src/schema.ts` | Add `companionTokens` table |

### Companion CLI (`packages/companion/`)

| File                 | Responsibility                                                             |
| -------------------- | -------------------------------------------------------------------------- |
| `src/cli.ts`         | Entry point: `mesh-companion connect <url> --token <token>`                |
| `src/client.ts`      | WebSocket client, auto-reconnect (5s), heartbeat ping (30s)                |
| `src/handlers/fs.ts` | Handle `fs.list` and `fs.stat` RPC calls                                   |
| `src/index.ts`       | Re-exports for programmatic use                                            |
| `package.json`       | `bin: { "mesh-companion": "./dist/cli.js" }`, depends on `ws`, `commander` |

### Frontend (`apps/web/`)

| File                    | Responsibility                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `app/settings/page.tsx` | Add "Companion" tab to existing tab bar                                            |
| `lib/api.ts`            | Add `companion.createToken()`, `companion.revokeToken()`, `companion.listTokens()` |

## Database Schema

```typescript
// packages/shared/src/schema.ts
export const companionTokens = pgTable('companion_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 100 }).notNull().default('default'),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  prefix: varchar('prefix', { length: 20 }).notNull(), // e.g. "mesh_comp_xxxx" for display
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at'),
});
```

Token format: `mesh_comp_<32 random hex chars>`. Stored as bcrypt hash. Prefix (first 12 chars) stored plaintext for display.

## JSON-RPC Protocol

All messages are JSON strings over WebSocket.

### Server → Companion (request)

```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "method": "fs.list",
  "params": { "path": "/Users/k/project" }
}
```

### Companion → Server (response)

```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "result": {
    "entries": [
      { "name": "web", "type": "dir" },
      { "name": "api", "type": "dir" }
    ]
  }
}
```

### Error response

```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "error": { "code": -32000, "message": "ENOENT: no such file or directory" }
}
```

### Methods (Subsystem 1)

| Method           | Direction          | Params             | Result                                                                |
| ---------------- | ------------------ | ------------------ | --------------------------------------------------------------------- |
| `fs.list`        | Server → Companion | `{ path: string }` | `{ entries: { name: string, type: "dir"\|"file", size?: number }[] }` |
| `fs.stat`        | Server → Companion | `{ path: string }` | `{ exists: boolean, readable: boolean, type: "dir"\|"file"\|null }`   |
| `companion.ping` | Companion → Server | `{}`               | `{}`                                                                  |

### Security: path traversal prevention

`fs.list` and `fs.stat` on the companion side must reject any path containing `..` segments:

```typescript
import path from 'path';
function safePath(p: string): string {
  const resolved = path.resolve(p);
  if (p.includes('..')) throw new Error('Path traversal not allowed');
  return resolved;
}
```

## Connection Lifecycle

```
mesh-companion connect https://server.com --token mesh_comp_xxx
  → WS connect to wss://server.com/ws/companion
  → Header: Authorization: Bearer mesh_comp_xxx
  → Server: verify token (bcrypt.compare), reject with 401 if invalid
  → Server: register in CompanionManager (tokenId → ws)
  → Server: push to browser via Redis pub/sub: { type: "companion.connected" }
  → Companion: ping every 30s
  → Server: update lastSeenAt on each ping
  → On disconnect: CompanionManager removes entry, push { type: "companion.disconnected" }
  → Companion: auto-reconnect after 5s
```

## Settings UI — Companion Tab

New tab added to `app/settings/page.tsx` alongside existing Providers / GitHub / Skills tabs.

**Content:**

- Connection status badge (green "Connected" / grey "Not connected") — driven by WebSocket event pushed from server
- Token section: masked display (`mesh_comp_••••xxxx`), Copy button, Revoke button
- "Generate new token" button — calls `POST /companion/tokens`, shows token once (not stored plaintext)
- Install instructions code block:
  ```
  npm install -g @meshagent/companion
  mesh-companion connect https://your-server.com --token <token>
  ```

**Only one token per user** for Subsystem 1. Multi-token support deferred.

## API Endpoints

| Method   | Path                    | Auth                  | Description                                                  |
| -------- | ----------------------- | --------------------- | ------------------------------------------------------------ | ------------------------------------ |
| `GET`    | `/companion/tokens`     | JWT                   | List tokens (id, prefix, label, lastSeenAt) for current user |
| `POST`   | `/companion/tokens`     | JWT                   | Create token; returns plaintext once                         |
| `DELETE` | `/companion/tokens/:id` | JWT                   | Revoke token; closes active WS if connected                  |
| `GET`    | `/ws/companion`         | Bearer token (header) | WebSocket upgrade for companion daemon                       |
| `GET`    | `/companion/status`     | JWT                   | Returns `{ connected: boolean, lastSeenAt: string            | null }` for current user's companion |

## Companion CLI Usage

```bash
# Install
npm install -g @meshagent/companion

# Connect (runs in foreground, Ctrl+C to stop)
mesh-companion connect https://your-server.com --token mesh_comp_xxx

# Output
# ✓ Connected to MeshAgent at https://your-server.com
# ✓ Companion ready — serving fs.list, fs.stat
# Ping every 30s. Ctrl+C to disconnect.
```

## Migration

New table `companion_tokens` — add to the existing Drizzle migration flow:

```bash
cd packages/shared && pnpm drizzle-kit generate
# apply migration on deploy
```

## Responsive / Error Behavior

- Token generate button disabled while a token already exists (one token per user)
- If companion disconnects mid-session: server pushes `companion.disconnected`, browser shows grey badge; pending RPC calls time out after 10s with user-visible error
- WS connection rejected with 401 if token invalid or revoked

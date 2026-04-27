# Overview Provider Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Provider Breakdown card to the overview page that shows sessions, success rate, and avg duration per CLI provider (claude/gemini/cursor).

**Architecture:** New `GET /agents/metrics/by-provider` endpoint queries `agentSessions` grouped by `cliProvider` (NULL treated as 'claude'). Frontend adds `api.agents.metricsByProvider()` method and a new `ProviderBreakdownCard` component rendered below the AI Activity Card in the overview page.

**Tech Stack:** Fastify, Drizzle ORM (raw SQL via `sql` tag), React, Next.js, Vitest, Tailwind CSS

---

## File Map

| Action | Path |
|---|---|
| **Modify** | `apps/api/src/routes/agents.ts` — add `GET /agents/metrics/by-provider` |
| **Create** | `apps/api/src/__tests__/agents-metrics-by-provider.test.ts` |
| **Modify** | `apps/web/lib/api.ts` — add `agents.metricsByProvider()` |
| **Create** | `apps/web/components/overview/ProviderBreakdownCard.tsx` |
| **Modify** | `apps/web/app/overview/page.tsx` — fetch + render card |

---

## Task 1: API — `GET /agents/metrics/by-provider`

**Files:**
- Modify: `apps/api/src/routes/agents.ts` (add after the existing `/agents/metrics` handler)
- Create: `apps/api/src/__tests__/agents-metrics-by-provider.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/__tests__/agents-metrics-by-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { agentRoutes } from '../routes/agents.js'

async function buildApp(dbRows: any[] = []): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.decorate('authenticate', async (_req: any, _reply: any) => {
    _req.user = { id: 'user-1', role: 'admin' }
  })

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue(dbRows),
    // For other routes in agentRoutes that need these methods
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  }
  app.decorate('db', mockDb)
  app.decorate('redis', { publish: vi.fn() })

  await app.register(agentRoutes)
  return app
}

describe('GET /agents/metrics/by-provider', () => {
  let app: FastifyInstance

  afterEach(async () => { await app.close() })

  it('returns perProvider array with session stats', async () => {
    app = await buildApp([
      { provider: 'claude', count: 12, successCount: 10, avgDurationMs: 270000 },
      { provider: 'gemini', count: 3,  successCount: 3,  avgDurationMs: 180000 },
    ])

    const res = await app.inject({ method: 'GET', url: '/agents/metrics/by-provider' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sinceHours).toBe(24)
    expect(body.perProvider).toHaveLength(2)
    expect(body.perProvider[0]).toMatchObject({
      provider: 'claude',
      count: 12,
      successCount: 10,
      avgDurationMs: 270000,
    })
  })

  it('returns empty perProvider when no sessions', async () => {
    app = await buildApp([])
    const res = await app.inject({ method: 'GET', url: '/agents/metrics/by-provider' })
    expect(res.statusCode).toBe(200)
    expect(res.json().perProvider).toEqual([])
  })

  it('respects sinceHours query param', async () => {
    app = await buildApp([])
    const res = await app.inject({ method: 'GET', url: '/agents/metrics/by-provider?sinceHours=168' })
    expect(res.statusCode).toBe(200)
    expect(res.json().sinceHours).toBe(168)
  })

  it('rejects sinceHours > 720 with 400', async () => {
    app = await buildApp([])
    const res = await app.inject({ method: 'GET', url: '/agents/metrics/by-provider?sinceHours=999' })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run test → verify FAIL**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api
npm run test -- agents-metrics-by-provider.test
```

Expected: FAIL — route does not exist yet

- [ ] **Step 3: Add the endpoint to `apps/api/src/routes/agents.ts`**

Add these imports at the top (if not already present — `sql` and `agentSessions` should already be imported):

```typescript
import { agentSessions } from '@meshagent/shared'
// sql should already be imported from drizzle-orm
```

Add the new handler **after** the existing `GET /agents/metrics` handler (around line 218):

```typescript
fastify.get('/agents/metrics/by-provider', { preHandler }, async (request, reply) => {
  const { sinceHours } = z
    .object({ sinceHours: z.coerce.number().int().min(1).max(720).default(24) })
    .parse(request.query)

  const since = new Date(Date.now() - sinceHours * 3600 * 1000)

  const rows = await fastify.db
    .select({
      provider: sql<string>`COALESCE(${agentSessions.cliProvider}, 'claude')`,
      count: sql<number>`count(*)::int`,
      successCount: sql<number>`sum(CASE WHEN ${agentSessions.status} = 'completed' THEN 1 ELSE 0 END)::int`,
      avgDurationMs: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${agentSessions.endedAt} - ${agentSessions.startedAt})) * 1000), 0)::int`,
    })
    .from(agentSessions)
    .where(gte(agentSessions.createdAt, since))
    .groupBy(sql`COALESCE(${agentSessions.cliProvider}, 'claude')`)

  return { sinceHours, perProvider: rows }
})
```

Note: `gte`, `sql` are already imported from `drizzle-orm` at the top of the file. `agentSessions` is already imported from `@meshagent/shared`.

- [ ] **Step 4: Run test → verify PASS**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api
npm run test -- agents-metrics-by-provider.test
```

Expected: 4 tests PASS

- [ ] **Step 5: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api
npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/kriangkrai/project/mesh-agent
git add apps/api/src/routes/agents.ts apps/api/src/__tests__/agents-metrics-by-provider.test.ts
git commit -m "feat(api): add GET /agents/metrics/by-provider endpoint"
```

---

## Task 2: Frontend — API client + card component + overview page

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/overview/ProviderBreakdownCard.tsx`
- Modify: `apps/web/app/overview/page.tsx`

- [ ] **Step 1: Add `metricsByProvider` to `apps/web/lib/api.ts`**

Find the `agents` object (around line 105). After the existing `metrics` method (line 142):

```typescript
metrics: (sinceHours = 24) => request<any>(`/agents/metrics?sinceHours=${sinceHours}`),
```

Add:
```typescript
metricsByProvider: (sinceHours = 24) =>
  request<{ sinceHours: number; perProvider: Array<{ provider: string; count: number; successCount: number; avgDurationMs: number }> }>(
    `/agents/metrics/by-provider?sinceHours=${sinceHours}`
  ),
```

- [ ] **Step 2: Create `apps/web/components/overview/ProviderBreakdownCard.tsx`**

```tsx
'use client'

const PROVIDER_COLOR: Record<string, string> = {
  claude: '#facc15',
  gemini: '#60a5fa',
  cursor: '#4ade80',
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

interface ProviderRow {
  provider: string
  count: number
  successCount: number
  avgDurationMs: number
}

interface Props {
  perProvider: ProviderRow[]
  sinceHours: number
  error?: string
}

export function ProviderBreakdownCard({ perProvider, sinceHours, error }: Props) {
  const total = perProvider.reduce((s, r) => s + r.count, 0)

  const label = sinceHours === 24
    ? 'last 24 hours'
    : sinceHours % 24 === 0
    ? `last ${sinceHours / 24} days`
    : `last ${sinceHours}h`

  return (
    <div className="bg-surface border border-border rounded-xl mb-6 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="text-[12px] font-semibold text-muted uppercase tracking-wider">Provider Breakdown</span>
        </div>
        <span className="text-[11px] text-dim">{label}</span>
      </div>

      <div className="p-5">
        {error ? (
          <p className="text-[13px] text-danger">Unable to load provider data</p>
        ) : perProvider.length === 0 ? (
          <p className="text-[13px] text-dim">No agent sessions in the last {sinceHours} hours</p>
        ) : (
          <div className="flex flex-col gap-4">
            {perProvider.map((row) => {
              const color = PROVIDER_COLOR[row.provider] ?? '#6a7a8e'
              const pct = total > 0 ? Math.round((row.count / total) * 100) : 0
              const successRate = row.count > 0 ? Math.round((row.successCount / row.count) * 100) : 0
              return (
                <div key={row.provider}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-[13px] font-medium text-text capitalize">{row.provider}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-dim">{row.count} {row.count === 1 ? 'session' : 'sessions'}</span>
                      <span className="text-[11px] font-medium w-7 text-right" style={{ color }}>{pct}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden mb-1.5">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-dim">{successRate}% success</span>
                    <span className="text-dim text-[10px]">·</span>
                    <span className="text-[11px] text-dim">avg {formatDuration(row.avgDurationMs)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire into `apps/web/app/overview/page.tsx`**

**Add import** at the top of the file (after existing component imports):
```tsx
import { ProviderBreakdownCard } from '@/components/overview/ProviderBreakdownCard'
```

**Add state** in `OverviewPage` (after the existing state declarations around line 127):
```tsx
const [providerMetrics, setProviderMetrics] = useState<{ sinceHours: number; perProvider: any[] } | null>(null)
const [providerError, setProviderError] = useState('')
```

**Add fetch** in `fetchData` inside `Promise.all` (add as a 6th parallel call):

Change:
```tsx
const [p, t, a, m, tok] = await Promise.all([
  api.projects.list(),
  api.tasks.list(),
  api.agents.list(),
  api.agents.metrics(24 * 7),
  api.metrics.tokens(),
])
setProjects(p)
setTasks(t)
setAgents(a)
setMetrics(m)
setTokenStats(tok)
```

To:
```tsx
const [p, t, a, m, tok, provByProvider] = await Promise.all([
  api.projects.list(),
  api.tasks.list(),
  api.agents.list(),
  api.agents.metrics(24 * 7),
  api.metrics.tokens(),
  api.agents.metricsByProvider(24 * 7).catch(() => null),
])
setProjects(p)
setTasks(t)
setAgents(a)
setMetrics(m)
setTokenStats(tok)
if (provByProvider) {
  setProviderMetrics(provByProvider)
} else {
  setProviderError('Unable to load provider data')
}
```

**Add card** in JSX — insert between the AI Activity Card closing tag and Row 2 (around line 417, after `</div>` that closes the AI Activity card and before the `{/* Row 2 */}` comment):

```tsx
{/* Provider Breakdown */}
<ProviderBreakdownCard
  perProvider={providerMetrics?.perProvider ?? []}
  sinceHours={providerMetrics?.sinceHours ?? 168}
  error={providerError}
/>
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/web
npm run typecheck 2>/dev/null || npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
cd /Users/kriangkrai/project/mesh-agent
git add apps/web/lib/api.ts \
        apps/web/components/overview/ProviderBreakdownCard.tsx \
        apps/web/app/overview/page.tsx
git commit -m "feat(web): add provider breakdown card to overview page"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered in |
|---|---|
| `GET /agents/metrics/by-provider?sinceHours=24` | Task 1 Step 3 |
| Groups by `cliProvider`, NULL → 'claude' | Task 1 Step 3 (`COALESCE`) |
| Returns count, successCount, avgDurationMs | Task 1 Step 3 |
| Only providers with count > 0 included | Inherent in GROUP BY (no rows = no result) |
| Invalid sinceHours → 400 | Task 1 Step 3 (Zod max 720) |
| `api.agents.metricsByProvider()` method | Task 2 Step 1 |
| `ProviderBreakdownCard` component | Task 2 Step 2 |
| Progress bar (proportion of sessions) | Task 2 Step 2 (`pct = count/total*100`) |
| Success rate display | Task 2 Step 2 (`successRate`) |
| Avg duration display (Xm Ys format) | Task 2 Step 2 (`formatDuration`) |
| Empty state | Task 2 Step 2 (perProvider.length === 0) |
| API error state | Task 2 Step 2 + Step 3 (`.catch(() => null)`) |
| Card placed below AI Activity Card | Task 2 Step 3 |
| Same sinceHours as metrics (7 days) | Task 2 Step 3 (`24 * 7`) |

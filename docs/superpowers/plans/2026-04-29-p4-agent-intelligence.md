# P4 — Agent Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agents project-aware by injecting a project brief + auto-read codebase docs into every agent prompt, and persisting agent run summaries per project so future agents see what has been done before.

**Architecture:** Two new DB tables (`projectContext`, `agentOutcomes`) store project docs and agent run history. A new `context-builder.ts` lib loads and formats them into a context block that is prepended to every agent prompt before dispatch. Context injection happens at the call-site (not inside `dispatchAgent`) so the existing function signature is unchanged.

**Tech Stack:** Fastify, Drizzle ORM (PostgreSQL), ioredis, TypeScript, Next.js (React)

---

## File Map

| File                                  | Action       | Responsibility                                                                     |
| ------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `packages/shared/src/schema.ts`       | **Modify**   | Add `projectContext` + `agentOutcomes` tables                                      |
| `packages/shared/drizzle/`            | **Generate** | New migration SQL from schema change                                               |
| `apps/api/src/lib/context-builder.ts` | **Create**   | `buildContextBlock(projectId, fastify)` — loads and formats context                |
| `apps/api/src/routes/projects.ts`     | **Modify**   | `POST /projects/:id/context` + `GET /projects/:id/context`                         |
| `apps/api/src/routes/internal.ts`     | **Modify**   | Insert `agentOutcomes` row on agent complete; inject context in `dispatchNextWave` |
| `apps/api/src/routes/chat.ts`         | **Modify**   | Inject context block before dispatching agents                                     |
| `apps/api/src/routes/tasks.ts`        | **Modify**   | Inject context block in `POST /tasks/:id/start`                                    |
| `apps/api/src/lib/quality-gate.ts`    | **Modify**   | Inject context block in `triggerQualityGate`                                       |
| `apps/web/lib/api.ts`                 | **Modify**   | Add `projects.saveContext()` + `projects.getContext()`                             |
| `apps/web/app/projects/page.tsx`      | **Modify**   | Add "Context" tab with brief textarea + autoContext preview                        |

---

### Task 1: Add schema tables and generate migration

**Files:**

- Modify: `packages/shared/src/schema.ts`

- [ ] **Step 1: Add two new tables to schema.ts**

Open `packages/shared/src/schema.ts`. After the last table definition (`taskActivities`), append:

```typescript
export const projectContext = pgTable('project_context', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  brief: text('brief').notNull().default(''),
  autoContext: text('auto_context').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentOutcomes = pgTable(
  'agent_outcomes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    summary: text('summary').notNull(),
    prUrl: text('pr_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    projectCreatedIdx: index('agent_outcomes_project_created_idx').on(t.projectId, t.createdAt),
  }),
);
```

- [ ] **Step 2: Generate migration**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/shared
DATABASE_URL=postgresql://postgres:postgres@localhost:4803/meshagent npm run db:generate
```

Expected: new file created in `packages/shared/drizzle/` named `0007_*.sql` (or next number).

- [ ] **Step 3: Apply migration**

```bash
cd /Users/kriangkrai/project/mesh-agent/packages/shared
DATABASE_URL=postgresql://postgres:postgres@localhost:4803/meshagent npm run db:migrate
```

Expected: `All migrations applied successfully` (or similar success message).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add \
  packages/shared/src/schema.ts \
  packages/shared/drizzle/
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(schema): add projectContext and agentOutcomes tables"
```

---

### Task 2: Create context-builder.ts

**Files:**

- Create: `apps/api/src/lib/context-builder.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/api/src/lib/context-builder.ts
import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { projectContext, agentOutcomes } from '@meshagent/shared';

const AUTO_CONTEXT_INJECT_LIMIT = 2000; // chars injected into prompt
const OUTCOMES_LIMIT = 5;

export async function buildContextBlock(
  projectId: string | null | undefined,
  fastify: FastifyInstance,
): Promise<string> {
  if (!projectId) return '';
  try {
    const [ctx] = await fastify.db
      .select()
      .from(projectContext)
      .where(eq(projectContext.projectId, projectId))
      .limit(1);

    const outcomes = await fastify.db
      .select()
      .from(agentOutcomes)
      .where(eq(agentOutcomes.projectId, projectId))
      .orderBy(desc(agentOutcomes.createdAt))
      .limit(OUTCOMES_LIMIT);

    const parts: string[] = [];

    if (ctx?.brief?.trim()) {
      parts.push(`## Project Context\n${ctx.brief.trim()}`);
    }

    if (ctx?.autoContext?.trim()) {
      const truncated =
        ctx.autoContext.length > AUTO_CONTEXT_INJECT_LIMIT
          ? ctx.autoContext.slice(0, AUTO_CONTEXT_INJECT_LIMIT) + '\n…(truncated)'
          : ctx.autoContext;
      parts.push(`## Codebase Overview\n${truncated.trim()}`);
    }

    if (outcomes.length > 0) {
      const lines = outcomes.map((o) => {
        const pr = o.prUrl ? ` — PR: ${o.prUrl}` : ' — no PR';
        return `- [${o.role}] ${o.summary}${pr}`;
      });
      parts.push(`## Recent Work\n${lines.join('\n')}`);
    }

    if (parts.length === 0) return '';
    return parts.join('\n\n');
  } catch (err) {
    fastify.log.warn({ err, projectId }, 'buildContextBlock failed — skipping context injection');
    return '';
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/lib/context-builder.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): add context-builder — buildContextBlock for agent prompt injection"
```

---

### Task 3: Add POST/GET /projects/:id/context

**Files:**

- Modify: `apps/api/src/routes/projects.ts`

- [ ] **Step 1: Add imports**

Read `apps/api/src/routes/projects.ts` first to see existing imports. Then add the missing ones:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectContext } from '@meshagent/shared';
```

(`projects` is already imported. Add only what's missing.)

- [ ] **Step 2: Add the two new routes**

Inside `projectRoutes(fastify)`, after the existing routes, add:

```typescript
fastify.get('/projects/:id/context', { preHandler }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const [ctx] = await fastify.db
    .select()
    .from(projectContext)
    .where(eq(projectContext.projectId, id))
    .limit(1);
  return ctx ?? { projectId: id, brief: '', autoContext: '', updatedAt: null };
});

fastify.post('/projects/:id/context', { preHandler }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const { brief = '' } = (request.body ?? {}) as { brief?: string };

  // Load project to find read directory
  const [project] = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) return reply.status(404).send({ error: 'Project not found' });

  const readDir =
    project.workspacePath ??
    Object.values((project.paths as Record<string, string>) ?? {})[0] ??
    null;

  // Auto-read CLAUDE.md + README.md (best-effort)
  let autoContext = '';
  if (readDir) {
    const candidates = ['CLAUDE.md', 'README.md'];
    const chunks: string[] = [];
    for (const filename of candidates) {
      try {
        const content = await readFile(join(readDir, filename), 'utf-8');
        if (content.trim()) chunks.push(content.trim());
        if (chunks.join('\n\n').length >= 4000) break;
      } catch {
        // file not found or unreadable — skip
      }
    }
    autoContext = chunks.join('\n\n---\n\n').slice(0, 4000);
  }

  // Upsert projectContext row
  await fastify.db
    .insert(projectContext)
    .values({ projectId: id, brief: brief.trim(), autoContext, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: projectContext.projectId,
      set: { brief: brief.trim(), autoContext, updatedAt: new Date() },
    });

  return { ok: true, autoContext };
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/routes/projects.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): add GET/POST /projects/:id/context endpoints"
```

---

### Task 4: Save agentOutcomes on agent complete

**Files:**

- Modify: `apps/api/src/routes/internal.ts`

- [ ] **Step 1: Add import**

Add `agentOutcomes` to the existing `@meshagent/shared` import in `internal.ts`:

```typescript
import { tasks, taskComments, taskActivities, projects, agentOutcomes } from '@meshagent/shared';
```

- [ ] **Step 2: Insert agentOutcomes after extracting summary**

In the `agent-complete` handler, after the QG reviewer check block and after `const prUrl = extractPrUrl(outputLog)` and `const summary = buildSummary(outputLog)`, add:

```typescript
// Persist outcome for future context injection
if (projectId) {
  fastify.db
    .insert(agentOutcomes)
    .values({ projectId, role, summary, prUrl: prUrl ?? null })
    .catch((err: unknown) =>
      fastify.log.warn({ err, projectId, role }, 'Failed to insert agentOutcomes'),
    );
}
```

(Fire-and-forget — do not `await` so it never blocks the response.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add apps/api/src/routes/internal.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): persist agentOutcomes on agent complete"
```

---

### Task 5: Inject context block at all dispatch sites

**Files:**

- Modify: `apps/api/src/routes/chat.ts`
- Modify: `apps/api/src/routes/tasks.ts`
- Modify: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/src/lib/quality-gate.ts`

Context injection pattern — the same snippet applied at each dispatch site:

```typescript
import { buildContextBlock } from '../lib/context-builder.js';

// Before building fullPrompt:
const contextBlock = await buildContextBlock(projectId ?? null, fastify);
// Then prepend to prompt:
const fullPrompt = contextBlock
  ? `${contextBlock}\n\n---\n\n${taskDescription}${gitInstructions}`
  : `${taskDescription}${gitInstructions}`;
```

- [ ] **Step 1: Inject in chat.ts dispatch handler**

Read `apps/api/src/routes/chat.ts`. Find the section inside `POST /chat/dispatch` where `fullPrompt` is built (it uses `taskBrief.description` + `buildGitInstructions`). Add:

```typescript
import { buildContextBlock } from '../lib/context-builder.js';
```

Then replace the `fullPrompt` construction with:

```typescript
const contextBlock = await buildContextBlock(proposal.projectId ?? null, fastify);
const fullPrompt = contextBlock
  ? `${contextBlock}\n\n---\n\n${taskBrief.description}${imagePaths}${buildGitInstructions(proposal.baseBranch, proposal.branchSuffix)}`
  : `${taskBrief.description}${imagePaths}${buildGitInstructions(proposal.baseBranch, proposal.branchSuffix)}`;
```

(Read the existing prompt construction carefully first — preserve any image block or other additions already there.)

- [ ] **Step 2: Inject in tasks.ts POST /tasks/:id/start**

Read `apps/api/src/routes/tasks.ts`. Find where `fullPrompt` is assembled inside the `/tasks/:id/start` route. Add the import and replace `fullPrompt` construction:

```typescript
import { buildContextBlock } from '../lib/context-builder.js';

// After loading projectPaths and leadResult:
const contextBlock = await buildContextBlock(task.projectId ?? null, fastify);
const fullPrompt = contextBlock
  ? `${contextBlock}\n\n---\n\n${taskBrief.description}${imageBlock}${gitInstructions}`
  : `${taskBrief.description}${imageBlock}${gitInstructions}`;
```

- [ ] **Step 3: Inject in internal.ts dispatchNextWave**

In `apps/api/src/routes/internal.ts`, add import (if not already there from Task 4):

```typescript
import { buildContextBlock } from '../lib/context-builder.js';
```

In the `dispatchNextWave` function, after `projectPaths` is loaded and before `fullPrompt` is built, add:

```typescript
const contextBlock = await buildContextBlock(state.projectId, fastify);
const fullPrompt = contextBlock
  ? `${contextBlock}\n\n---\n\n${contextBlock ? '' : ''}${state.taskDescription}${imageBlock}${gitInstructions}`
  : `${state.taskDescription}${imageBlock}${gitInstructions}`;
```

Wait — read the existing `fullPrompt` construction in `dispatchNextWave` first. It currently is:

```typescript
const fullPrompt = `${contextBlock}\n${state.taskDescription}${imageBlock}${gitInstructions}`;
```

(where `contextBlock` is the _wave previous-summary block_, not project context). Rename the wave summary variable to avoid shadowing:

```typescript
const waveSummaryBlock = prevSummary
  ? `\n\n## ผลงานจาก Wave ก่อนหน้า\n${prevSummary}\n\n## คำสั่งปัจจุบัน`
  : '';

const projectCtxBlock = await buildContextBlock(state.projectId, fastify);
const fullPrompt = projectCtxBlock
  ? `${projectCtxBlock}\n\n---\n\n${waveSummaryBlock}\n${state.taskDescription}${imageBlock}${gitInstructions}`
  : `${waveSummaryBlock}\n${state.taskDescription}${imageBlock}${gitInstructions}`;
```

- [ ] **Step 4: Inject in quality-gate.ts triggerQualityGate**

In `apps/api/src/lib/quality-gate.ts`, add import:

```typescript
import { buildContextBlock } from './context-builder.js';
```

In `triggerQualityGate`, after building `prompt` with `buildReviewerPrompt`, prepend project context:

```typescript
const ctxBlock = await buildContextBlock(opts.projectId, fastify);
const enrichedPrompt = ctxBlock ? `${ctxBlock}\n\n---\n\n${prompt}` : prompt;

const result = await dispatchAgent(
  'reviewer',
  reviewerWorkingDir,
  enrichedPrompt, // was: prompt
  { projectId: opts.projectId, taskId: null, createdBy: opts.createdBy },
  role?.systemPrompt ?? undefined,
);
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/api/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/api/tsconfig.json --noEmit
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add \
  apps/api/src/routes/chat.ts \
  apps/api/src/routes/tasks.ts \
  apps/api/src/routes/internal.ts \
  apps/api/src/lib/quality-gate.ts
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(api): inject project context block into all agent dispatch sites"
```

---

### Task 6: Frontend — Context tab in Project Settings

**Files:**

- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/projects/page.tsx`

- [ ] **Step 1: Add API client methods**

In `apps/web/lib/api.ts`, inside the `projects` object, add:

```typescript
getContext: (id: string) =>
  request<{ projectId: string; brief: string; autoContext: string; updatedAt: string | null }>(
    `/projects/${id}/context`,
  ),
saveContext: (id: string, brief: string) =>
  request<{ ok: boolean; autoContext: string }>(
    `/projects/${id}/context`,
    { method: 'POST', body: JSON.stringify({ brief }) },
  ),
```

- [ ] **Step 2: Read projects/page.tsx to understand the tab structure**

Read `apps/web/app/projects/page.tsx` — find where `ProjectDetail` renders tabs (Details / GitHub). Understand the existing tab pattern (state variable, tab buttons, conditional rendering).

- [ ] **Step 3: Add "Context" tab to ProjectDetail**

In `ProjectDetail` component, add a new tab. First add state:

```typescript
const [activeTab, setActiveTab] = useState<'details' | 'github' | 'context'>('details');
const [brief, setBrief] = useState('');
const [autoContext, setAutoContext] = useState('');
const [contextLoading, setContextLoading] = useState(false);
const [savingContext, setSavingContext] = useState(false);
```

Load context when the tab is first opened — add a `useEffect`:

```typescript
useEffect(() => {
  if (activeTab === 'context' && project?.id) {
    setContextLoading(true);
    api.projects
      .getContext(project.id)
      .then((ctx) => {
        setBrief(ctx.brief ?? '');
        setAutoContext(ctx.autoContext ?? '');
      })
      .catch(() => {})
      .finally(() => setContextLoading(false));
  }
}, [activeTab, project?.id]);
```

Add the save handler:

```typescript
async function handleSaveContext() {
  if (!project?.id) return;
  setSavingContext(true);
  try {
    const result = await api.projects.saveContext(project.id, brief);
    setAutoContext(result.autoContext);
  } catch (e: any) {
    alert(e.message ?? 'Save failed');
  } finally {
    setSavingContext(false);
  }
}
```

Add "Context" to the tab buttons (follow the existing tab button style exactly):

```tsx
<button
  onClick={() => setActiveTab('context')}
  className={activeTab === 'context' ? '... active classes ...' : '... inactive classes ...'}
>
  Context
</button>
```

Add the Context tab panel (rendered when `activeTab === 'context'`):

```tsx
{
  activeTab === 'context' && (
    <div className="flex flex-col gap-4">
      {contextLoading ? (
        <p className="text-[13px] text-muted">Loading…</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-muted font-medium">Project Brief</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={6}
              placeholder="Describe this project for agents: tech stack, conventions, key files, architecture…"
              className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 placeholder-dim resize-none"
            />
            <p className="text-[11px] text-dim">
              Injected into every agent prompt for this project.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-muted font-medium">
              Codebase Overview (auto-read)
            </label>
            <div className="w-full bg-canvas border border-border rounded px-3 py-2 text-[12px] text-muted min-h-[60px] whitespace-pre-wrap break-words">
              {autoContext
                ? autoContext.slice(0, 500) + (autoContext.length > 500 ? '\n…' : '')
                : 'No CLAUDE.md or README.md found in project directory.'}
            </div>
            <p className="text-[11px] text-dim">
              Auto-read from CLAUDE.md / README.md when you save.
            </p>
          </div>
          <button
            onClick={handleSaveContext}
            disabled={savingContext}
            className="self-start bg-accent/90 hover:bg-accent text-canvas text-[13px] font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-50"
          >
            {savingContext ? 'Saving…' : 'Save & Refresh'}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
/Users/kriangkrai/project/mesh-agent/apps/web/node_modules/.bin/tsc \
  -p /Users/kriangkrai/project/mesh-agent/apps/web/tsconfig.json --noEmit 2>&1 | head -20
```

Expected: 0 new errors (pre-existing errors unrelated to this change are acceptable)

- [ ] **Step 5: Commit**

```bash
git -C /Users/kriangkrai/project/mesh-agent add \
  apps/web/lib/api.ts \
  apps/web/app/projects/page.tsx
git -C /Users/kriangkrai/project/mesh-agent commit -m "feat(web): add Context tab to project settings for brief + autoContext"
```

---

## Self-Review

**Spec coverage:**

- ✅ `projectContext` table — Task 1
- ✅ `agentOutcomes` table with index on `(projectId, createdAt)` — Task 1
- ✅ Migration generated and applied — Task 1
- ✅ `buildContextBlock()` — loads brief + autoContext (capped 2000 chars) + last 5 outcomes — Task 2
- ✅ Empty sections omitted (returns `''` when nothing to inject) — Task 2
- ✅ `POST /projects/:id/context` — saves brief + auto-reads CLAUDE.md/README.md — Task 3
- ✅ `GET /projects/:id/context` — returns existing context or empty defaults — Task 3
- ✅ Auto-read: tries CLAUDE.md first, then README.md, cap 4000 chars, best-effort — Task 3
- ✅ `agentOutcomes` insert on agent complete (fire-and-forget) — Task 4
- ✅ Context injected at: chat.ts dispatch, tasks.ts start, internal.ts dispatchNextWave, quality-gate.ts — Task 5
- ✅ Wave summary variable renamed to avoid shadowing project context variable — Task 5
- ✅ `api.projects.getContext()` + `api.projects.saveContext()` — Task 6
- ✅ Context tab in ProjectDetail — brief textarea + autoContext preview + Save button — Task 6

**Placeholder scan:** No TBDs. All code blocks complete. Tab button classes instruction says "follow existing style" — this is valid since the implementer MUST read the file first (Step 2) to get exact class names.

**Type consistency:**

- `buildContextBlock(projectId, fastify)` defined in Task 2, imported and called in Tasks 5 (4 sites) ✓
- `projectContext` table defined in Task 1, used in Tasks 3 (upsert) and 2 (select) ✓
- `agentOutcomes` table defined in Task 1, used in Tasks 2 (select) and 4 (insert) ✓
- `api.projects.getContext()` returns `{ brief, autoContext }` — matches what Task 6 uses (`ctx.brief`, `ctx.autoContext`) ✓
- `api.projects.saveContext()` returns `{ ok, autoContext }` — matches `result.autoContext` used in handleSaveContext ✓

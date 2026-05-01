# Folder Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a folder browser panel to the project path editor that lets users drag folders from their local companion filesystem onto agent role rows, replacing manual path typing.

**Architecture:** Two new server endpoints proxy `fs.list`/`fs.stat` calls from browser → Fastify → CompanionManager → companion daemon. A new `FolderBrowser` React component displays the directory tree with HTML5 drag support. The project edit modal gains an expand mode (max-w-5xl split panel) triggered by an "Open Folder Browser" button shown only when a companion is connected.

**Tech Stack:** TypeScript, Fastify, Zod, React, Next.js, Tailwind CSS, HTML5 Drag and Drop API

---

## File Map

| File                                              | Action | Responsibility                                            |
| ------------------------------------------------- | ------ | --------------------------------------------------------- |
| `apps/api/src/routes/companion.ts`                | Modify | Add `GET /companion/fs/list` and `GET /companion/fs/stat` |
| `apps/api/src/__tests__/companion.test.ts`        | Modify | Add tests for the two new endpoints                       |
| `apps/web/lib/api.ts`                             | Modify | Add `api.companion.fsList()` and `api.companion.fsStat()` |
| `apps/web/components/companion/FolderBrowser.tsx` | Create | Breadcrumb + directory listing + draggable entries        |
| `apps/web/app/projects/page.tsx`                  | Modify | Modal wide mode, PathRows drop props, browser panel       |

---

## Task 1: `/companion/fs/list` and `/companion/fs/stat` API Endpoints

**Files:**

- Modify: `apps/api/src/routes/companion.ts`
- Modify: `apps/api/src/__tests__/companion.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/api/src/__tests__/companion.test.ts`. Add a new `describe` block after the existing one:

```typescript
describe('Companion fs proxy routes', () => {
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

  it('GET /companion/fs/list returns 503 when no companion connected', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/companion/fs/list?path=/',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('Companion not connected');
  });

  it('GET /companion/fs/stat returns 503 when no companion connected', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/companion/fs/stat?path=/',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('Companion not connected');
  });

  it('GET /companion/fs/list returns 400 when path is missing', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/companion/fs/list',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /companion/fs/list returns 401 without auth', async () => {
    const res = await server.inject({ method: 'GET', url: '/companion/fs/list?path=/' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api && pnpm test src/__tests__/companion.test.ts
```

Expected: FAIL — routes not found (404)

- [ ] **Step 3: Add the two endpoints to companion.ts**

Open `apps/api/src/routes/companion.ts`. Find the closing `}` of `companionRoutes` and add before it:

```typescript
// Proxy fs.list to companion daemon
fastify.get('/companion/fs/list', { preHandler }, async (request, reply) => {
  const { id: userId } = request.user as { id: string };
  const parseResult = z.object({ path: z.string().min(1) }).safeParse(request.query);
  if (!parseResult.success) return reply.status(400).send({ error: 'path query param required' });
  const { path } = parseResult.data;
  try {
    const result = await companionManager.call<{ entries: { name: string; type: string }[] }>(
      userId,
      'fs.list',
      { path },
    );
    return result;
  } catch (err: any) {
    if (err.message === 'No companion connected for this user')
      return reply.status(503).send({ error: 'Companion not connected' });
    return reply.status(500).send({ error: err.message });
  }
});

// Proxy fs.stat to companion daemon
fastify.get('/companion/fs/stat', { preHandler }, async (request, reply) => {
  const { id: userId } = request.user as { id: string };
  const parseResult = z.object({ path: z.string().min(1) }).safeParse(request.query);
  if (!parseResult.success) return reply.status(400).send({ error: 'path query param required' });
  const { path } = parseResult.data;
  try {
    const result = await companionManager.call<{
      exists: boolean;
      readable: boolean;
      type: string | null;
    }>(userId, 'fs.stat', { path });
    return result;
  } catch (err: any) {
    if (err.message === 'No companion connected for this user')
      return reply.status(503).send({ error: 'Companion not connected' });
    return reply.status(500).send({ error: err.message });
  }
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api && pnpm test src/__tests__/companion.test.ts
```

Expected: all tests pass (both describe blocks)

- [ ] **Step 5: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/api && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/companion.ts apps/api/src/__tests__/companion.test.ts
git commit -m "feat(api): add companion/fs/list and companion/fs/stat proxy endpoints"
```

---

## Task 2: Frontend API Client Methods

**Files:**

- Modify: `apps/web/lib/api.ts`

- [ ] **Step 1: Add fsList and fsStat to the companion section**

Open `apps/web/lib/api.ts`. Find the `companion` section (around line 274). Add two methods after `status`:

```typescript
    fsList: (path: string) =>
      request<{ entries: { name: string; type: 'dir' | 'file' }[] }>(
        `/companion/fs/list?path=${encodeURIComponent(path)}`
      ),
    fsStat: (path: string) =>
      request<{ exists: boolean; readable: boolean; type: 'dir' | 'file' | null }>(
        `/companion/fs/stat?path=${encodeURIComponent(path)}`
      ),
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/web && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(web): add fsList and fsStat to companion API client"
```

---

## Task 3: FolderBrowser Component

**Files:**

- Create: `apps/web/components/companion/FolderBrowser.tsx`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p /Users/kriangkrai/project/mesh-agent/apps/web/components/companion
```

Create `apps/web/components/companion/FolderBrowser.tsx`:

```typescript
'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'

interface Entry {
  name: string
  type: 'dir' | 'file'
}

interface FolderBrowserProps {
  initialPath?: string
}

function buildBreadcrumbs(path: string): { label: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  const crumbs = [{ label: '/', path: '/' }]
  parts.forEach((part, i) => {
    crumbs.push({ label: part, path: '/' + parts.slice(0, i + 1).join('/') })
  })
  return crumbs
}

export function FolderBrowser({ initialPath = '/' }: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.companion.fsList(path)
      setEntries(res.entries)
      setCurrentPath(path)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(currentPath) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = buildBreadcrumbs(currentPath)

  return (
    <div className="flex flex-col h-full bg-canvas border border-border rounded-lg overflow-hidden">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-surface shrink-0 overflow-x-auto">
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-dim text-[11px]">/</span>}
            <button
              type="button"
              onClick={() => load(crumb.path)}
              className={`text-[11px] hover:text-accent transition-colors ${
                i === crumbs.length - 1 ? 'text-text font-medium' : 'text-muted'
              }`}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-[12px] text-dim animate-pulse">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <p className="text-[12px] text-danger text-center">{error}</p>
            <button
              type="button"
              onClick={() => load(currentPath)}
              className="text-[11px] text-accent hover:text-accent/80"
            >
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-[12px] text-dim text-center py-8">Empty directory</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {entries.map((entry) => {
              const fullPath = currentPath === '/'
                ? `/${entry.name}`
                : `${currentPath}/${entry.name}`
              const isDir = entry.type === 'dir'
              return (
                <div
                  key={entry.name}
                  draggable={isDir}
                  onDragStart={isDir ? (e) => {
                    e.dataTransfer.setData('text/plain', fullPath)
                    e.dataTransfer.effectAllowed = 'copy'
                  } : undefined}
                  onClick={isDir ? () => load(fullPath) : undefined}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[12px] transition-colors ${
                    isDir
                      ? 'cursor-grab active:cursor-grabbing hover:bg-surface-2 text-text'
                      : 'opacity-40 cursor-default text-muted'
                  }`}
                >
                  <span className="shrink-0">{isDir ? '📁' : '📄'}</span>
                  <span className="flex-1 truncate font-mono">{entry.name}</span>
                  {isDir && (
                    <span className="text-[9px] text-dim shrink-0">drag</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-border bg-surface shrink-0">
        <p className="text-[10px] text-dim">Drag 📁 folders to role rows on the left</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/web && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/companion/FolderBrowser.tsx
git commit -m "feat(web): add FolderBrowser component with drag support"
```

---

## Task 4: Project Edit Modal — Expand Mode + Drag & Drop

**Files:**

- Modify: `apps/web/app/projects/page.tsx`

This task modifies the existing `ProjectsPage` and its sub-components. Read the full file first to orient yourself before making changes.

- [ ] **Step 1: Add drop props to PathRows**

Open `apps/web/app/projects/page.tsx`. Find the `PathRows` function (starts around line 36). Update its props interface and add drop zone behavior to each row:

```typescript
function PathRows({
  rows,
  onChange,
  baseDir,
  dropTargetIdx,
  onRowDragOver,
  onRowDrop,
  onRowDragLeave,
}: {
  rows: PathEntry[]
  onChange: (next: PathEntry[]) => void
  baseDir?: string | null
  dropTargetIdx?: number | null
  onRowDragOver?: (idx: number) => void
  onRowDrop?: (idx: number, path: string) => void
  onRowDragLeave?: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-muted uppercase tracking-wider">Paths</span>
        <button type="button"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
          className="text-[13px] text-accent hover:text-accent/80">
          + add row
        </button>
      </div>
      <p className="text-[11px] text-dim mb-2">working directory ของแต่ละ agent role — เช่น <span className="font-mono text-muted">frontend → /Users/.../project/web</span></p>
      {rows.map((p, i) => {
        const isDropTarget = dropTargetIdx === i
        return (
          <div
            key={i}
            className={`flex gap-1.5 mb-1.5 rounded transition-all ${
              isDropTarget ? 'ring-2 ring-accent/50 bg-accent/5 p-1 -mx-1' : ''
            }`}
            onDragOver={onRowDragOver ? (e) => { e.preventDefault(); onRowDragOver(i) } : undefined}
            onDrop={onRowDrop ? (e) => { e.preventDefault(); onRowDrop(i, e.dataTransfer.getData('text/plain')) } : undefined}
            onDragLeave={onRowDragLeave}
          >
            {isDropTarget ? (
              <div className="flex-1 flex items-center justify-center py-2 text-[12px] text-accent border-2 border-dashed border-accent/40 rounded">
                Drop folder here
              </div>
            ) : (
              <>
                <input type="text" placeholder="เช่น frontend" value={p.key}
                  onChange={e => onChange(rows.map((x, idx) => idx === i ? { ...x, key: e.target.value } : x))}
                  className={`${INPUT_CLS} flex-[0_0_35%]`} />
                {baseDir ? (
                  <div className="flex items-center flex-1 bg-canvas border border-border rounded overflow-hidden">
                    <span className="text-[13px] text-dim font-mono px-2 py-1.5 border-r border-border shrink-0 whitespace-nowrap">
                      {baseDir}/
                    </span>
                    <input
                      type="text"
                      placeholder="folder-name"
                      value={p.value.startsWith(baseDir + '/') ? p.value.slice(baseDir.length + 1) : p.value}
                      onChange={e => {
                        const full = e.target.value.startsWith('/') ? e.target.value : `${baseDir}/${e.target.value}`
                        onChange(rows.map((x, idx) => idx === i ? { ...x, value: full } : x))
                      }}
                      className="flex-1 bg-transparent text-text text-[13px] px-2 py-1.5 outline-none font-mono"
                    />
                  </div>
                ) : (
                  <input type="text" placeholder="/Users/me/project/web" value={p.value}
                    onChange={e => onChange(rows.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}
                    className={`${INPUT_CLS} flex-1`} />
                )}
                {rows.length > 1 && (
                  <button type="button"
                    onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                    className="text-muted hover:text-danger text-[13px] px-1 transition-colors">✕</button>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Update Modal to accept a wide prop**

Find the `Modal` component (around line 484):

```typescript
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
});
```

Replace with:

```typescript
function Modal({ title, onClose, children, wide }: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className={`bg-surface border border-border-hi rounded-xl w-full glow-border fade-up flex flex-col max-h-[90vh] transition-all duration-200 ${wide ? 'max-w-5xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between px-5 pt-5 pb-0 shrink-0">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text text-[14px] transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 pt-4 pb-5">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add browser state to ProjectsPage**

In `ProjectsPage` (starts around line 499), add these state variables after the existing edit state declarations (after `const [saving, setSaving] = useState(false)`):

```typescript
// folder browser state
const [browserOpen, setBrowserOpen] = useState(false);
const [companionConnected, setCompanionConnected] = useState(false);
const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
```

Also add this import at the top of the file (after the existing imports):

```typescript
import { FolderBrowser } from '@/components/companion/FolderBrowser';
```

- [ ] **Step 4: Check companion status when edit modal opens**

Find the `openEdit` function:

```typescript
function openEdit(project: any) {
  setEditProject(project);
  setEName(project.name);
  setEBranch(project.baseBranch ?? 'main');
  setERepos(project.githubRepos ?? []);
  setEPaths(pathsToEntries(project.paths));
}
```

Add companion status check:

```typescript
function openEdit(project: any) {
  setEditProject(project);
  setEName(project.name);
  setEBranch(project.baseBranch ?? 'main');
  setERepos(project.githubRepos ?? []);
  setEPaths(pathsToEntries(project.paths));
  setBrowserOpen(false);
  api.companion
    .status()
    .then((s) => setCompanionConnected(s.connected))
    .catch(() => setCompanionConnected(false));
}
```

Also add a `closeEdit` cleanup (find where the edit modal is closed — look for `setEditProject(null)` calls — and reset browser state):

```typescript
function closeEdit() {
  setEditProject(null);
  setBrowserOpen(false);
  setDropTargetIdx(null);
}
```

Replace any inline `setEditProject(null)` in edit close handlers with `closeEdit()`.

- [ ] **Step 5: Add drop handler**

Add this handler in `ProjectsPage` (after `closeEdit`):

```typescript
const handleRowDrop = (idx: number, droppedPath: string) => {
  if (!droppedPath) return;
  setEPaths((prev) => prev.map((e, i) => (i === idx ? { ...e, value: droppedPath } : e)));
  setDropTargetIdx(null);
};
```

- [ ] **Step 6: Update the edit modal JSX**

Find the edit modal in the JSX (look for `editProject &&` and the `<Modal title="Edit Project"` block). Update it to:

1. Pass `wide={browserOpen}` to Modal
2. Add "Open Folder Browser" / "Close Browser" button
3. Render split layout when `browserOpen`
4. Pass drop props to PathRows

The edit modal paths section (find `<PathRows rows={ePaths}`) — replace the entire edit modal content with this structure (keep all existing form fields, just modify the paths section and add the browser):

```tsx
{
  editProject && (
    <Modal title="Edit Project" onClose={closeEdit} wide={browserOpen}>
      <form onSubmit={handleSaveEdit}>
        {/* existing fields: name, branch, repos — keep as-is */}
        ...
        {/* Paths section becomes split when browser open */}
        <div className="mt-4">
          <div className={browserOpen ? 'flex gap-4' : undefined}>
            <div className={browserOpen ? 'flex-1 min-w-0' : undefined}>
              <PathRows
                rows={ePaths}
                onChange={setEPaths}
                baseDir={reposBaseDir}
                dropTargetIdx={browserOpen ? dropTargetIdx : undefined}
                onRowDragOver={browserOpen ? setDropTargetIdx : undefined}
                onRowDrop={browserOpen ? handleRowDrop : undefined}
                onRowDragLeave={browserOpen ? () => setDropTargetIdx(null) : undefined}
              />
              {companionConnected && (
                <button
                  type="button"
                  onClick={() => setBrowserOpen((b) => !b)}
                  className="mt-2 text-[12px] text-accent hover:text-accent/80 flex items-center gap-1"
                >
                  {browserOpen ? '← Close Browser' : '📁 Open Folder Browser'}
                </button>
              )}
            </div>
            {browserOpen && (
              <div className="w-72 shrink-0">
                <FolderBrowser initialPath={reposBaseDir ?? '/'} />
              </div>
            )}
          </div>
        </div>
        {/* existing save/cancel buttons — keep as-is */}
        ...
      </form>
    </Modal>
  );
}
```

**Important:** Do not change the existing form fields (name, branch, repos sections) or the save/cancel buttons — only modify the paths section and wrap with the split layout. Read the current edit modal JSX carefully before editing.

- [ ] **Step 7: Typecheck**

```bash
cd /Users/kriangkrai/project/mesh-agent/apps/web && pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 8: Verify visually**

Start the dev server if not running:

```bash
cd /Users/kriangkrai/project/mesh-agent && pnpm dev
```

Open http://localhost:4800, login, go to Projects.

**Test without companion:**

- Click Edit on any project
- Confirm "Open Folder Browser" button is NOT shown

**Test with companion connected:**

- Run: `node /Users/kriangkrai/project/mesh-agent/packages/companion/dist/cli.js connect http://localhost:4801 --token <your-token>`
- Edit a project → "Open Folder Browser" button appears
- Click it → modal widens, right panel shows folder browser
- Navigate folders by clicking
- Drag a folder → drop onto a role row → path fills in
- Click "Close Browser" → modal narrows back

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/projects/page.tsx
git commit -m "feat(web): add folder browser expand mode with drag-and-drop path assignment"
```

---

## Self-Review

### Spec Coverage

| Spec requirement                                             | Task   |
| ------------------------------------------------------------ | ------ |
| `GET /companion/fs/list` endpoint (JWT, 503 if no companion) | Task 1 |
| `GET /companion/fs/stat` endpoint (JWT, 503 if no companion) | Task 1 |
| Tests for both endpoints                                     | Task 1 |
| `api.companion.fsList()` and `api.companion.fsStat()`        | Task 2 |
| `FolderBrowser` component with breadcrumb                    | Task 3 |
| Draggable dir entries (HTML5 dataTransfer)                   | Task 3 |
| File entries dimmed and non-draggable                        | Task 3 |
| Error state with Retry button                                | Task 3 |
| Loading state                                                | Task 3 |
| Modal expand (`max-w-5xl`) via `wide` prop                   | Task 4 |
| "Open Folder Browser" button only when companion connected   | Task 4 |
| Drop targets on PathRows with visual feedback                | Task 4 |
| Drop fills role row value                                    | Task 4 |
| `closeEdit` resets browser state                             | Task 4 |

### Placeholder Scan

None found.

### Type Consistency

- `FolderBrowser` props: `{ initialPath?: string }` — used as `<FolderBrowser initialPath={reposBaseDir ?? '/'} />` ✓
- `PathRows` new props: `dropTargetIdx`, `onRowDragOver`, `onRowDrop`, `onRowDragLeave` — all optional, typed correctly ✓
- `handleRowDrop(idx: number, droppedPath: string)` matches `onRowDrop?: (idx: number, path: string) => void` ✓
- `api.companion.fsList()` returns `{ entries: { name: string; type: 'dir' | 'file' }[] }` — used as `Entry[]` in FolderBrowser ✓

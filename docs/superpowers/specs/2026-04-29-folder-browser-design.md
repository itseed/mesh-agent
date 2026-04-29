# Folder Browser UI Design (Subsystem 2)

## Goal

Add a folder browser component to the project path editor that lets users drag folders from their local filesystem (via the companion tunnel) onto agent role rows — eliminating manual path typing.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Entry point | "Open Folder Browser" button in existing project edit modal | No new route; keeps modal-based UX consistent |
| Layout when open | Modal expands to ~80vw split panel | Enough room for browser without full-page context switch |
| Assignment UX | Drag folder from right panel → drop on role row | Intuitive; no extra clicks or popup menus |
| Folder navigation | Click folder to navigate deeper; breadcrumb to go back | Standard file browser pattern |
| Companion not connected | Button hidden (companion status checked on mount) | Clean; no disabled-state confusion |
| fs.list API | New `GET /companion/fs/list?path=` server endpoint | Frontend can't call companion directly; server proxies via CompanionManager |

## Scope (Subsystem 2 only)

- `GET /companion/fs/list` and `GET /companion/fs/stat` HTTP endpoints (server proxies to companion via CompanionManager)
- `FolderBrowser` React component (breadcrumb + directory listing + drag support)
- Project edit modal: expand/collapse toggle + drop targets on role rows
- `api.companion.fsList()` and `api.companion.fsStat()` frontend client methods

**Out of scope (Subsystem 3):** local agent spawning (`agent.spawn`, `agent.stdout`, `agent.kill`)

## New / Modified Files

| File | Action | Responsibility |
|---|---|---|
| `apps/api/src/routes/companion.ts` | Modify | Add `GET /companion/fs/list` and `GET /companion/fs/stat` endpoints |
| `apps/web/lib/api.ts` | Modify | Add `api.companion.fsList()` and `api.companion.fsStat()` |
| `apps/web/components/companion/FolderBrowser.tsx` | Create | Breadcrumb + directory listing + draggable entries |
| `apps/web/app/projects/page.tsx` | Modify | Expand/collapse toggle + drop targets on PathRows |

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/companion/fs/list` | JWT | Proxy `fs.list` to companion. Query param: `path` (required). Returns `{ entries: { name, type }[] }` |
| `GET` | `/companion/fs/stat` | JWT | Proxy `fs.stat` to companion. Query param: `path` (required). Returns `{ exists, readable, type }` |

Both endpoints return `503` if no companion is connected for the user, and forward any companion-side errors as `500`.

### Implementation pattern (in companion.ts)

```typescript
fastify.get('/companion/fs/list', { preHandler }, async (request, reply) => {
  const { id: userId } = request.user as { id: string }
  const { path } = z.object({ path: z.string().min(1) }).parse(request.query)
  try {
    const result = await companionManager.call<{ entries: { name: string; type: string }[] }>(
      userId, 'fs.list', { path }
    )
    return result
  } catch (err: any) {
    if (err.message === 'No companion connected for this user') return reply.status(503).send({ error: 'Companion not connected' })
    return reply.status(500).send({ error: err.message })
  }
})
```

`/companion/fs/stat` follows the same pattern with method `'fs.stat'`.

## Frontend API Client

```typescript
// apps/web/lib/api.ts — add to companion section
fsList: (path: string) =>
  request<{ entries: { name: string; type: 'dir' | 'file' }[] }>(`/companion/fs/list?path=${encodeURIComponent(path)}`),
fsStat: (path: string) =>
  request<{ exists: boolean; readable: boolean; type: 'dir' | 'file' | null }>(`/companion/fs/stat?path=${encodeURIComponent(path)}`),
```

## FolderBrowser Component

```
apps/web/components/companion/FolderBrowser.tsx
```

**Props:**
```typescript
interface FolderBrowserProps {
  initialPath?: string   // defaults to '/'
}
```

**Internal state:**
- `currentPath: string` — path currently displayed
- `entries: { name: string; type: 'dir' | 'file' }[]` — result of fsList for currentPath
- `loading: boolean`
- `error: string | null`

**Behavior:**
- On mount (and when `currentPath` changes): call `api.companion.fsList(currentPath)`
- Breadcrumb: split `currentPath` by `/`, each segment is clickable → navigate to that path
- Directory entries: rendered as draggable items. `onDragStart(fullPath)` fires on `dragstart`. Click navigates into the directory.
- File entries: rendered non-draggable, dimmed
- Error state: show error message with retry button
- Loading state: show spinner

## Project Edit Modal — Expand Mode

Changes to `apps/web/app/projects/page.tsx`:

**New state:**
```typescript
const [browserOpen, setBrowserOpen] = useState(false)
const [companionConnected, setCompanionConnected] = useState(false)
const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null)
```

**On modal open:** call `api.companion.status()` to set `companionConnected`.

**"Open Folder Browser" button:** shown only when `companionConnected === true`. On click: `setBrowserOpen(true)` → modal gains `max-w-5xl` class (instead of default `max-w-lg`).

**"Close Browser" button:** `setBrowserOpen(false)` → modal returns to `max-w-lg`.

**Drag data:** Use HTML5 `dataTransfer` — no extra state needed. `FolderBrowser` calls `e.dataTransfer.setData('text/plain', fullPath)` on `dragstart`. Drop targets read it with `e.dataTransfer.getData('text/plain')`.

**PathRows in expand mode:** pass additional props when `browserOpen`:
```typescript
interface PathRowsProps {
  rows: PathEntry[]
  onChange: (next: PathEntry[]) => void
  baseDir?: string | null
  // drop-mode props (only used when browser is open)
  dropTargetIdx?: number | null
  onRowDragOver?: (idx: number) => void
  onRowDrop?: (idx: number, path: string) => void
  onRowDragLeave?: () => void
}
```

Each role row in drop mode:
- `onDragOver`: `e.preventDefault(); onRowDragOver?.(i)`
- `onDrop`: `e.preventDefault(); onRowDrop?.(i, e.dataTransfer.getData('text/plain'))`
- `onDragLeave`: `onRowDragLeave?.()`
- Visual when `dropTargetIdx === i`: dashed border + blue tint + "drop folder here" label

**`onRowDrop` handler in parent:**
```typescript
const handleRowDrop = (idx: number, droppedPath: string) => {
  setPathEntries(prev => prev.map((e, i) => i === idx ? { ...e, value: droppedPath } : e))
  setDropTargetIdx(null)
}
```

**Layout when `browserOpen`:**
```tsx
<div className="flex gap-4">
  <div className="flex-1">
    <PathRows
      rows={pathEntries}
      onChange={setPathEntries}
      baseDir={baseDir}
      dropTargetIdx={dropTargetIdx}
      onRowDragOver={setDropTargetIdx}
      onRowDrop={handleRowDrop}
      onRowDragLeave={() => setDropTargetIdx(null)}
    />
  </div>
  <div className="w-80 shrink-0">
    <FolderBrowser initialPath={baseDir ?? '/'} />
  </div>
</div>
```

## UX Details

- **Starting path:** `reposBaseDir` from settings if set, otherwise `/`
- **Hidden files:** already filtered by `fs.ts` (entries starting with `.` are excluded)
- **File entries:** shown dimmed and non-draggable (dirs only are useful for path assignment)
- **Drag implementation:** `draggable="true"` on dir entry divs; `onDragStart` calls `e.dataTransfer.setData('text/plain', fullPath)`
- **Drag cursor:** `cursor-grab` on dir entries, `cursor-grabbing` while dragging
- **Drop feedback:** dashed border + blue tint on active drop target row
- **After drop:** role row `value` updates immediately; no auto-save
- **Companion disconnects mid-session:** `fsList` call returns 503 → error state shown in browser panel; user can still edit paths manually

## Error Handling

| Scenario | Behaviour |
|---|---|
| Companion not connected | "Open Folder Browser" button hidden |
| `fsList` returns 503 | FolderBrowser shows "Companion not connected" with close button |
| `fsList` returns 500 | FolderBrowser shows error message + Retry button |
| Path has no read permission | Entry shows EACCES note; still navigable up via breadcrumb |
| Companion disconnects while browsing | Next `fsList` call fails → error state in panel; paths already dropped are preserved |

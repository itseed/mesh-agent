'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

/* ── types ── */
interface PathEntry { key: string; value: string }

/* ── helpers ── */
function pathsToEntries(paths: Record<string, string> = {}): PathEntry[] {
  const e = Object.entries(paths).map(([key, value]) => ({ key, value }))
  return e.length > 0 ? e : [{ key: '', value: '' }]
}

function buildPathsMap(entries: PathEntry[]) {
  return Object.fromEntries(
    entries.filter(e => e.key.trim() && e.value.trim())
      .map(e => [e.key.trim(), e.value.trim()])
  )
}

const INPUT_CLS = 'bg-canvas border border-border text-text text-[14px] rounded px-2.5 py-1.5 placeholder-dim w-full'

/* ── PathRows (module-level component) ── */
function PathRows({
  rows,
  onChange,
}: {
  rows: PathEntry[]
  onChange: (next: PathEntry[]) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-muted uppercase tracking-wider">Paths</span>
        <button type="button"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
          className="text-[13px] text-accent hover:text-accent/80">
          + add row
        </button>
      </div>
      {rows.map((p, i) => (
        <div key={i} className="flex gap-1.5 mb-1.5">
          <input type="text" placeholder="role" value={p.key}
            onChange={e => onChange(rows.map((x, idx) => idx === i ? { ...x, key: e.target.value } : x))}
            className={`${INPUT_CLS} flex-[0_0_35%]`} />
          <input type="text" placeholder="/path/to/dir" value={p.value}
            onChange={e => onChange(rows.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}
            className={`${INPUT_CLS} flex-1`} />
          {rows.length > 1 && (
            <button type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="text-muted hover:text-danger text-[13px] px-1 transition-colors">✕</button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── RepoPicker ── */
function RepoPicker({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (repos: string[]) => void
}) {
  const [available, setAvailable] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)
  const [manual, setManual] = useState('')

  useEffect(() => {
    api.settings.listRepos()
      .then(list => setAvailable(list))
      .catch(() => setFallback(true))
      .finally(() => setLoading(false))
  }, [])

  function toggle(fullName: string) {
    onChange(selected.includes(fullName)
      ? selected.filter(r => r !== fullName)
      : [...selected, fullName])
  }

  function addManual() {
    const t = manual.trim()
    if (!t || selected.includes(t)) return
    onChange([...selected, t])
    setManual('')
  }

  const filtered = useMemo(() =>
    available.filter(r => r.fullName.toLowerCase().includes(search.toLowerCase())),
    [available, search]
  )

  const selectedChips = (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {selected.map(r => (
        <span key={r} className="text-[12px] bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded flex items-center gap-1">
          {r.includes('/') ? r.split('/')[1] : r}
          <button type="button" onClick={() => toggle(r)} className="hover:text-danger leading-none">✕</button>
        </span>
      ))}
    </div>
  )

  if (loading) {
    return <p className="text-muted text-[13px]"><span className="cursor-blink">▋</span> Loading repos…</p>
  }

  if (fallback) {
    return (
      <div>
        <p className="text-[12px] text-dim mb-2">GitHub ไม่ได้เชื่อมต่อ — กรอก owner/repo ด้วยมือ (Enter เพื่อเพิ่ม):</p>
        <div className="flex gap-2 mb-2">
          <input type="text" placeholder="owner/repo" value={manual}
            onChange={e => setManual(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addManual())}
            className={`${INPUT_CLS} flex-1`} />
          <button type="button" onClick={addManual}
            className="text-[13px] text-accent border border-accent/30 px-3 py-1.5 rounded hover:bg-accent/10 shrink-0">Add</button>
        </div>
        {selected.length > 0 && selectedChips}
      </div>
    )
  }

  return (
    <div>
      <input type="text" placeholder="Search repos…" value={search}
        onChange={e => setSearch(e.target.value)}
        className={`${INPUT_CLS} mb-2`} />
      <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="text-muted text-[13px] p-3">No repos found.</p>
        ) : filtered.map(r => (
          <button key={r.fullName} type="button" onClick={() => toggle(r.fullName)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
              selected.includes(r.fullName) ? 'bg-accent/5' : 'hover:bg-surface-2'
            }`}>
            <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center text-[10px] font-bold ${
              selected.includes(r.fullName) ? 'bg-accent border-accent text-canvas' : 'border-border-hi'
            }`}>{selected.includes(r.fullName) ? '✓' : ''}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-text truncate">{r.fullName}</div>
              {r.description && <div className="text-[11px] text-muted truncate">{r.description}</div>}
            </div>
            {r.private && <span className="text-[10px] text-dim border border-border px-1 rounded shrink-0">private</span>}
          </button>
        ))}
      </div>
      {selected.length > 0 && selectedChips}
    </div>
  )
}

/* ── GitHub tab ── */
function GitHubTab({ project }: { project: any }) {
  const repos: string[] = project.githubRepos ?? []
  const [activeRepo, setActiveRepo] = useState(repos[0] ?? '')
  const [tab, setTab] = useState<'prs' | 'commits'>('prs')
  const [prs, setPrs] = useState<any[]>([])
  const [commits, setCommits] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeRepo) return
    setLoading(true)
    setError('')
    Promise.all([api.github.prs(activeRepo), api.github.commits(activeRepo)])
      .then(([p, c]) => { setPrs(p); setCommits(c) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [activeRepo])

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl opacity-10 mb-3">⌥</div>
        <p className="text-[14px] text-muted">No GitHub repos linked.</p>
        <p className="text-[13px] text-dim mt-1">Edit the project to add repos.</p>
      </div>
    )
  }

  return (
    <div>
      {repos.length > 1 && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {repos.map(r => (
            <button key={r} type="button" onClick={() => setActiveRepo(r)}
              className={`text-[12px] px-2.5 py-1 rounded border transition-all ${
                activeRepo === r
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted hover:border-border-hi'
              }`}>{r}</button>
          ))}
        </div>
      )}
      <div className="flex mb-4 bg-surface border border-border rounded p-0.5 w-fit">
        {(['prs', 'commits'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-3 py-1 rounded text-[13px] font-medium transition-all ${
              tab === t ? 'bg-canvas text-text shadow-sm' : 'text-muted hover:text-text'
            }`}>
            {t === 'prs' ? `PRs (${prs.length})` : `Commits (${commits.length})`}
          </button>
        ))}
      </div>
      {error && <p className="text-danger text-[13px] mb-3">✕ {error}</p>}
      {loading ? (
        <p className="text-muted text-[13px]"><span className="cursor-blink">▋</span> Loading…</p>
      ) : tab === 'prs' ? (
        <div className="flex flex-col gap-2">
          {prs.length === 0
            ? <p className="text-muted text-[13px]">No open PRs.</p>
            : prs.map((pr: any) => (
              <div key={pr.id ?? pr.number} className="bg-surface border border-border rounded-lg p-3 hover:border-border-hi transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <a href={pr.url ?? pr.html_url} target="_blank" rel="noreferrer"
                      className="text-[14px] text-accent hover:underline">
                      #{pr.number} {pr.title}
                    </a>
                    <p className="text-[12px] text-muted mt-0.5">{pr.user?.login ?? pr.author} · {pr.state}</p>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 font-medium ${
                    pr.state === 'open'
                      ? 'bg-success/15 text-success border border-success/20'
                      : 'bg-muted/10 text-muted border border-border'
                  }`}>{pr.state}</span>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {commits.length === 0
            ? <p className="text-muted text-[13px]">No commits found.</p>
            : commits.map((c: any, i: number) => (
              <div key={c.sha ?? i} className="bg-surface border border-border rounded-lg p-3 hover:border-border-hi transition-colors">
                <p className="text-[13px] text-text truncate leading-snug">{c.commit?.message ?? c.message}</p>
                <p className="text-[11px] text-muted mt-1">
                  <span className="font-mono text-dim">{(c.sha ?? c.id ?? '').slice(0, 7)}</span>
                  {' · '}{c.commit?.author?.name ?? c.author}
                </p>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

/* ── Details tab ── */
function DetailsTab({ project, onEdit, onDelete }: {
  project: any
  onEdit: () => void
  onDelete: () => void
}) {
  const repos: string[] = project.githubRepos ?? []
  const paths: Record<string, string> = project.paths ?? {}

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-2">GitHub Repos</div>
        {repos.length === 0 ? (
          <p className="text-[13px] text-dim">No repos linked. Edit project to add repos.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {repos.map(r => (
              <div key={r} className="flex items-center gap-2">
                <span className="text-accent text-[14px]">⌥</span>
                <a href={`https://github.com/${r}`} target="_blank" rel="noreferrer"
                  className="text-[14px] text-text hover:text-accent transition-colors font-mono">
                  {r}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-2">Paths</div>
        {Object.keys(paths).length === 0 ? (
          <p className="text-[13px] text-dim">No paths configured. Edit project to add paths.</p>
        ) : (
          <div className="bg-canvas rounded-lg border border-border overflow-hidden">
            {Object.entries(paths).map(([role, dir], i, arr) => (
              <div key={role} className={`flex items-center gap-3 px-3 py-2 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                <span className="text-[13px] text-muted w-24 shrink-0">{role}</span>
                <span className="text-[13px] font-mono text-text truncate">{dir}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2 border-t border-border">
        <button onClick={onEdit}
          className="text-[13px] border border-border text-muted px-3 py-1.5 rounded hover:text-text hover:border-border-hi transition-all">
          Edit project
        </button>
        <button onClick={onDelete}
          className="text-[13px] border border-danger/30 text-danger/80 px-3 py-1.5 rounded hover:bg-danger/10 transition-all">
          Delete project
        </button>
      </div>
    </div>
  )
}

/* ── ProjectDetail panel ── */
function ProjectDetail({ project, onEdit, onDelete }: {
  project: any
  onEdit: () => void
  onDelete: () => void
}) {
  const [tab, setTab] = useState<'details' | 'github'>('details')

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-semibold text-text">{project.name}</h2>
          {project.isActive && (
            <span className="text-[11px] bg-success/15 text-success border border-success/20 px-1.5 py-0.5 rounded-full font-medium">
              active
            </span>
          )}
        </div>
      </div>
      <div className="flex px-6 pt-3 border-b border-border shrink-0">
        {(['details', 'github'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-all -mb-px ${
              tab === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
            }`}>
            {t === 'github' ? 'GitHub' : 'Details'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'details'
          ? <DetailsTab project={project} onEdit={onEdit} onDelete={onDelete} />
          : <GitHubTab project={project} />}
      </div>
    </div>
  )
}

/* ── Modal wrapper ── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border-hi rounded-xl w-full max-w-lg glow-border fade-up flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-0 shrink-0">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text text-[14px] transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 pt-4 pb-5">{children}</div>
      </div>
    </div>
  )
}

/* ── Main page ── */
export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<any | null>(null)
  const [activating, setActivating] = useState<string | null>(null)

  // create state
  const [showCreate, setShowCreate] = useState(false)
  const [cName, setCName] = useState('')
  const [cRepos, setCRepos] = useState<string[]>([])
  const [cPaths, setCPaths] = useState<PathEntry[]>([{ key: '', value: '' }])
  const [creating, setCreating] = useState(false)

  // edit state
  const [editProject, setEditProject] = useState<any | null>(null)
  const [eName, setEName] = useState('')
  const [eRepos, setERepos] = useState<string[]>([])
  const [ePaths, setEPaths] = useState<PathEntry[]>([{ key: '', value: '' }])
  const [saving, setSaving] = useState(false)

  // delete state
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchProjects = useCallback(async () => {
    try {
      const data = await api.projects.list()
      setProjects(data)
      setError('')
      setSelected((prev: any) => prev ? (data.find((p: any) => p.id === prev.id) ?? prev) : null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  async function selectProject(project: any) {
    setSelected(project)
    setConfirmDelete(null)
    if (!project.isActive) {
      setActivating(project.id)
      try {
        await api.projects.activate(project.id)
        await fetchProjects()
      } catch { /* ignore */ } finally {
        setActivating(null)
      }
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!cName.trim()) return
    setCreating(true)
    setError('')
    try {
      const created = await api.projects.create({
        name: cName.trim(), paths: buildPathsMap(cPaths), githubRepos: cRepos,
      })
      setCName(''); setCRepos([]); setCPaths([{ key: '', value: '' }])
      setShowCreate(false)
      await fetchProjects()
      if (created?.id) setSelected(created)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  function openEdit(project: any) {
    setEditProject(project)
    setEName(project.name)
    setERepos(project.githubRepos ?? [])
    setEPaths(pathsToEntries(project.paths))
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editProject || !eName.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.projects.update(editProject.id, {
        name: eName.trim(), paths: buildPathsMap(ePaths), githubRepos: eRepos,
      })
      setEditProject(null)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      await api.projects.delete(id)
      setConfirmDelete(null)
      if (selected?.id === id) setSelected(null)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="flex h-screen overflow-hidden">
          {/* ── Left panel ── */}
          <div className="w-72 shrink-0 border-r border-border flex flex-col bg-canvas/30">
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <div>
                <h1 className="text-[15px] font-semibold text-text">Projects</h1>
                <p className="text-[12px] text-muted mt-0.5">
                  {projects.length} project{projects.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => { setShowCreate(true); setError('') }}
                className="text-[12px] bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent font-semibold px-2.5 py-1 rounded transition-all"
              >
                + New
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {error && <p className="text-danger text-[12px] px-2 mb-2">✕ {error}</p>}
              {loading ? (
                <p className="text-muted text-[13px] px-2 py-3"><span className="cursor-blink">▋</span> Loading…</p>
              ) : projects.length === 0 ? (
                <p className="text-muted text-[13px] px-2 py-3">No projects yet. Create one →</p>
              ) : projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => selectProject(project)}
                  className={`w-full text-left p-3 rounded-lg mb-1 transition-all border ${
                    selected?.id === project.id
                      ? 'bg-accent/10 border-accent/20 text-text'
                      : 'border-transparent hover:bg-surface text-muted hover:text-text'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] font-medium truncate flex-1">{project.name}</span>
                    {activating === project.id
                      ? <span className="text-[11px] text-muted shrink-0">…</span>
                      : project.isActive
                        ? <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                        : null}
                  </div>
                  <div className="text-[12px] mt-0.5 opacity-70">
                    {project.githubRepos?.length ?? 0} repo{project.githubRepos?.length !== 1 ? 's' : ''}
                    {' · '}
                    {Object.keys(project.paths ?? {}).length} path{Object.keys(project.paths ?? {}).length !== 1 ? 's' : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="flex-1 overflow-hidden">
            {selected ? (
              <ProjectDetail
                project={selected}
                onEdit={() => { openEdit(selected); setConfirmDelete(null) }}
                onDelete={() => setConfirmDelete(selected.id)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="text-5xl opacity-10 mb-4">◎</div>
                <p className="text-[14px] text-muted">Select a project to view details</p>
                <p className="text-[13px] text-dim mt-1">Or create a new one with + New</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Delete confirm ── */}
        {confirmDelete && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-border-hi rounded-xl p-6 w-full max-w-sm glow-border fade-up text-center">
              <p className="text-[15px] font-medium text-text mb-1">ลบ project นี้?</p>
              <p className="text-[13px] text-muted mb-5">ไม่สามารถย้อนกลับได้</p>
              <div className="flex gap-3 justify-center">
                <button type="button" onClick={() => setConfirmDelete(null)}
                  className="text-[14px] text-muted px-4 py-2 border border-border rounded hover:text-text transition-all">
                  ยกเลิก
                </button>
                <button type="button" onClick={() => handleDelete(confirmDelete)} disabled={deleting}
                  className="text-[14px] text-canvas bg-danger/90 hover:bg-danger px-4 py-2 rounded disabled:opacity-50 transition-colors">
                  {deleting ? '…' : 'ลบ'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Create modal ── */}
        {showCreate && (
          <Modal title="New project" onClose={() => setShowCreate(false)}>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <input type="text" placeholder="Project name" value={cName}
                onChange={e => setCName(e.target.value)}
                className={INPUT_CLS} autoFocus required />
              <div>
                <div className="text-[12px] text-muted uppercase tracking-wider mb-2">GitHub Repos</div>
                <RepoPicker selected={cRepos} onChange={setCRepos} />
              </div>
              <PathRows rows={cPaths} onChange={setCPaths} />
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="text-muted text-[14px] px-3 py-1.5 hover:text-text transition-colors">Cancel</button>
                <button type="submit" disabled={creating}
                  className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-50">
                  {creating ? '…' : 'Create'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* ── Edit modal ── */}
        {editProject && (
          <Modal title="Edit project" onClose={() => setEditProject(null)}>
            <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
              <input type="text" placeholder="Project name" value={eName}
                onChange={e => setEName(e.target.value)}
                className={INPUT_CLS} autoFocus required />
              <div>
                <div className="text-[12px] text-muted uppercase tracking-wider mb-2">GitHub Repos</div>
                <RepoPicker selected={eRepos} onChange={setERepos} />
              </div>
              <PathRows rows={ePaths} onChange={setEPaths} />
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setEditProject(null)}
                  className="text-muted text-[14px] px-3 py-1.5 hover:text-text transition-colors">Cancel</button>
                <button type="submit" disabled={saving}
                  className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-50">
                  {saving ? '…' : 'Save'}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </AppShell>
    </AuthGuard>
  )
}

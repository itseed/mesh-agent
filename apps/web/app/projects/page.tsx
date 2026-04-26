'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

interface PathEntry { key: string; value: string }

function pathsToEntries(paths: Record<string, string> = {}): PathEntry[] {
  const entries = Object.entries(paths).map(([key, value]) => ({ key, value }))
  return entries.length > 0 ? entries : [{ key: '', value: '' }]
}

function reposToString(repos: string[] = []): string {
  return repos.join(', ')
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [paths, setPaths] = useState<PathEntry[]>([{ key: '', value: '' }])
  const [repos, setRepos] = useState('')
  const [creating, setCreating] = useState(false)

  // Edit modal
  const [editProject, setEditProject] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editPaths, setEditPaths] = useState<PathEntry[]>([{ key: '', value: '' }])
  const [editRepos, setEditRepos] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Activate
  const [activating, setActivating] = useState<string | null>(null)

  const fetchProjects = useCallback(async () => {
    try {
      const data = await api.projects.list()
      setProjects(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  // Path helpers (shared)
  function makePathHelpers(
    setter: React.Dispatch<React.SetStateAction<PathEntry[]>>
  ) {
    return {
      add: () => setter((p) => [...p, { key: '', value: '' }]),
      update: (i: number, f: 'key' | 'value', v: string) =>
        setter((p) => p.map((e, idx) => idx === i ? { ...e, [f]: v } : e)),
      remove: (i: number) =>
        setter((p) => p.filter((_, idx) => idx !== i)),
    }
  }

  const createHelpers = makePathHelpers(setPaths)
  const editHelpers = makePathHelpers(setEditPaths)

  function buildPayload(
    n: string,
    ps: PathEntry[],
    rs: string
  ) {
    const pathsMap = Object.fromEntries(
      ps.filter((p) => p.key.trim() && p.value.trim()).map((p) => [p.key.trim(), p.value.trim()])
    )
    const githubRepos = rs.split(',').map((r) => r.trim()).filter(Boolean)
    return { name: n.trim(), paths: pathsMap, githubRepos }
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      await api.projects.create(buildPayload(name, paths, repos))
      setName('')
      setPaths([{ key: '', value: '' }])
      setRepos('')
      setShowCreate(false)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  function openEdit(project: any) {
    setEditProject(project)
    setEditName(project.name)
    setEditPaths(pathsToEntries(project.paths))
    setEditRepos(reposToString(project.githubRepos))
    setError('')
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editProject || !editName.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.projects.update(editProject.id, buildPayload(editName, editPaths, editRepos))
      setEditProject(null)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteProject(id: string) {
    setDeleting(true)
    setError('')
    try {
      await api.projects.delete(id)
      setConfirmDelete(null)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  async function activate(id: string) {
    setActivating(id)
    try {
      await api.projects.activate(id)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActivating(null)
    }
  }

  const inputCls = 'bg-canvas border border-border text-text text-[14px] rounded px-2.5 py-1.5 placeholder-dim w-full'

  function PathRows({
    rows,
    helpers,
  }: {
    rows: PathEntry[]
    helpers: ReturnType<typeof makePathHelpers>
  }) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] text-muted uppercase tracking-wider">Paths</span>
          <button type="button" onClick={helpers.add} className="text-[13px] text-accent hover:text-accent/80">
            + add row
          </button>
        </div>
        {rows.map((p, i) => (
          <div key={i} className="flex gap-1.5 mb-1.5">
            <input
              type="text"
              placeholder="role"
              value={p.key}
              onChange={(e) => helpers.update(i, 'key', e.target.value)}
              className={`${inputCls} flex-[0_0_35%]`}
            />
            <input
              type="text"
              placeholder="/path/to/dir"
              value={p.value}
              onChange={(e) => helpers.update(i, 'value', e.target.value)}
              className={`${inputCls} flex-1`}
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => helpers.remove(i)}
                className="text-muted hover:text-danger text-[13px] px-1 transition-colors"
              >✕</button>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-[15px] font-semibold text-text tracking-tight">Projects</h1>
              <p className="text-[13px] text-muted mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => { setShowCreate(true); setError('') }}
              className="flex items-center gap-1.5 bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent text-[13px] font-semibold px-3 py-1.5 rounded transition-all"
            >
              + New project
            </button>
          </div>

          {error && <p className="text-danger text-[14px] mb-4">✕ {error}</p>}

          {loading ? (
            <p className="text-muted text-[14px]"><span className="cursor-blink">▋</span> Loading…</p>
          ) : projects.length === 0 ? (
            <div className="bg-surface border border-border rounded-lg p-8 text-center">
              <p className="text-[14px] text-muted">No projects yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`bg-surface border rounded-lg p-4 transition-colors ${
                    project.isActive ? 'border-accent/25 bg-accent/[0.03]' : 'border-border hover:border-border-hi'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[15px] font-medium text-text">{project.name}</span>
                        {project.isActive && (
                          <span className="text-[12px] bg-success/15 text-success border border-success/20 px-1.5 py-0.5 rounded-full font-medium">
                            active
                          </span>
                        )}
                      </div>
                      {project.paths && Object.keys(project.paths).length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                          {Object.entries(project.paths).map(([k, v]) => (
                            <span key={k} className="text-[12px] text-dim">
                              <span className="text-muted">{k}</span>: {v as string}
                            </span>
                          ))}
                        </div>
                      )}
                      {project.githubRepos?.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {project.githubRepos.map((r: string) => (
                            <span key={r} className="text-[12px] text-accent/80 font-mono">⌥ {r}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {!project.isActive && (
                        <button
                          onClick={() => activate(project.id)}
                          disabled={activating === project.id}
                          className="text-[13px] text-accent border border-accent/30 px-2.5 py-1 rounded hover:bg-accent/10 disabled:opacity-50 transition-all"
                        >
                          {activating === project.id ? '…' : 'Set active'}
                        </button>
                      )}
                      <button
                        onClick={() => { openEdit(project); setConfirmDelete(null) }}
                        className="text-[13px] text-muted border border-border px-2.5 py-1 rounded hover:text-text hover:border-border-hi transition-all"
                      >
                        Edit
                      </button>
                      {confirmDelete === project.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] text-danger">ลบ?</span>
                          <button
                            onClick={() => deleteProject(project.id)}
                            disabled={deleting}
                            className="text-[13px] text-danger border border-danger/30 px-2 py-1 rounded hover:bg-danger/10 disabled:opacity-50"
                          >
                            {deleting ? '…' : 'ยืนยัน'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-[13px] text-muted px-2 py-1 hover:text-text"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setConfirmDelete(project.id); setEditProject(null) }}
                          className="text-[13px] text-muted px-2 py-1 hover:text-danger transition-colors"
                        >
                          ลบ
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-border-hi rounded-xl w-full max-w-md p-5 glow-border fade-up overflow-y-auto max-h-[90vh]">
              <h2 className="text-[14px] font-semibold text-text mb-4">New project</h2>
              <form onSubmit={createProject} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                  autoFocus
                  required
                />
                <PathRows rows={paths} helpers={createHelpers} />
                <div>
                  <label className="text-[12px] text-muted uppercase tracking-wider block mb-2">
                    GitHub Repos <span className="text-dim normal-case">(optional, comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="owner/repo, owner/repo2"
                    value={repos}
                    onChange={(e) => setRepos(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="flex gap-2 justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="text-muted text-[14px] px-3 py-1.5 hover:text-text transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    {creating ? '…' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit modal */}
        {editProject && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-border-hi rounded-xl w-full max-w-md p-5 glow-border fade-up overflow-y-auto max-h-[90vh]">
              <h2 className="text-[14px] font-semibold text-text mb-4">Edit project</h2>
              <form onSubmit={saveEdit} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Project name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={inputCls}
                  autoFocus
                  required
                />
                <PathRows rows={editPaths} helpers={editHelpers} />
                <div>
                  <label className="text-[12px] text-muted uppercase tracking-wider block mb-2">
                    GitHub Repos <span className="text-dim normal-case">(optional, comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="owner/repo, owner/repo2"
                    value={editRepos}
                    onChange={(e) => setEditRepos(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="flex gap-2 justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => setEditProject(null)}
                    className="text-muted text-[14px] px-3 py-1.5 hover:text-text transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    {saving ? '…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  )
}

'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface PathEntry { key: string; value: string }

export default function ProjectsPage() {
  const { token } = useAuth()
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [paths, setPaths] = useState<PathEntry[]>([{ key: '', value: '' }])
  const [creating, setCreating] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)

  const fetchProjects = useCallback(async () => {
    if (!token) return
    try {
      const data = await api.projects.list(token)
      setProjects(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  function addPathRow() { setPaths((p) => [...p, { key: '', value: '' }]) }
  function updatePath(i: number, f: 'key' | 'value', v: string) {
    setPaths((p) => p.map((e, idx) => idx === i ? { ...e, [f]: v } : e))
  }
  function removePath(i: number) { setPaths((p) => p.filter((_, idx) => idx !== i)) }

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !name.trim()) return
    setCreating(true)
    try {
      const pathsMap = Object.fromEntries(
        paths.filter((p) => p.key.trim() && p.value.trim()).map((p) => [p.key.trim(), p.value.trim()])
      )
      await api.projects.create(token, { name: name.trim(), paths: pathsMap })
      setName('')
      setPaths([{ key: '', value: '' }])
      setShowModal(false)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function activate(id: string) {
    if (!token) return
    setActivating(id)
    try {
      await api.projects.activate(token, id)
      fetchProjects()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActivating(null)
    }
  }

  const inputCls = 'bg-canvas border border-border text-text text-[14px] rounded px-2.5 py-1.5 placeholder-dim w-full'

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
              onClick={() => setShowModal(true)}
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
                  className={`bg-surface border rounded-lg p-4 flex items-start justify-between gap-4 transition-colors ${
                    project.isActive ? 'border-accent/25 bg-accent/[0.03]' : 'border-border hover:border-border-hi'
                  }`}
                >
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
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                        {Object.entries(project.paths).map(([k, v]) => (
                          <span key={k} className="text-[12px] text-dim">
                            <span className="text-muted">{k}</span>: {v as string}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {!project.isActive && (
                    <button
                      onClick={() => activate(project.id)}
                      disabled={activating === project.id}
                      className="text-[13px] text-accent border border-accent/30 px-3 py-1.5 rounded hover:bg-accent/10 disabled:opacity-50 transition-all shrink-0"
                    >
                      {activating === project.id ? '…' : 'Set active'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-border-hi rounded-xl w-full max-w-md p-5 glow-border fade-up">
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
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] text-muted uppercase tracking-wider">Paths</span>
                    <button type="button" onClick={addPathRow} className="text-[13px] text-accent hover:text-accent/80">
                      + add row
                    </button>
                  </div>
                  {paths.map((p, i) => (
                    <div key={i} className="flex gap-1.5 mb-1.5">
                      <input
                        type="text"
                        placeholder="role"
                        value={p.key}
                        onChange={(e) => updatePath(i, 'key', e.target.value)}
                        className={`${inputCls} flex-[0_0_35%]`}
                      />
                      <input
                        type="text"
                        placeholder="/path/to/dir"
                        value={p.value}
                        onChange={(e) => updatePath(i, 'value', e.target.value)}
                        className={`${inputCls} flex-1`}
                      />
                      {paths.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePath(i)}
                          className="text-muted hover:text-danger text-[13px] px-1 transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
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
      </AppShell>
    </AuthGuard>
  )
}

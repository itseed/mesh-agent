'use client'
import { useState, useEffect, useCallback } from 'react'
import { TopNav } from '@/components/layout/TopNav'
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

  function addPathRow() {
    setPaths((prev) => [...prev, { key: '', value: '' }])
  }

  function updatePath(i: number, field: 'key' | 'value', val: string) {
    setPaths((prev) => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  }

  function removePath(i: number) {
    setPaths((prev) => prev.filter((_, idx) => idx !== i))
  }

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

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas">
        <TopNav />
        <main className="p-6 pb-24">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg font-semibold">Projects</h1>
            <button
              onClick={() => setShowModal(true)}
              className="bg-accent text-canvas text-xs font-semibold px-3 py-1.5 rounded-lg"
            >
              + New Project
            </button>
          </div>
          {error && <p className="text-danger text-sm mb-4">{error}</p>}
          {loading ? (
            <p className="text-muted text-sm">Loading projects...</p>
          ) : projects.length === 0 ? (
            <p className="text-muted text-sm">No projects yet. Create one to get started.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{project.name}</span>
                      {project.isActive && (
                        <span className="text-xs bg-success/20 text-success px-1.5 py-0.5 rounded">active</span>
                      )}
                    </div>
                    {project.paths && Object.keys(project.paths).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {Object.entries(project.paths).map(([k, v]) => (
                          <span key={k} className="text-xs text-muted font-mono">{k}: {v as string}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {!project.isActive && (
                    <button
                      onClick={() => activate(project.id)}
                      disabled={activating === project.id}
                      className="text-xs text-accent border border-accent/40 px-3 py-1.5 rounded-lg hover:bg-accent/10 disabled:opacity-50"
                    >
                      {activating === project.id ? 'Setting...' : 'Set Active'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
        {showModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-xl w-full max-w-md p-6">
              <h2 className="text-sm font-semibold mb-4">New Project</h2>
              <form onSubmit={createProject} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-canvas border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  autoFocus
                  required
                />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted">Paths</span>
                    <button type="button" onClick={addPathRow} className="text-xs text-accent">+ Add path</button>
                  </div>
                  {paths.map((p, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="role (e.g. frontend)"
                        value={p.key}
                        onChange={(e) => updatePath(i, 'key', e.target.value)}
                        className="flex-1 bg-canvas border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                      />
                      <input
                        type="text"
                        placeholder="/path/to/dir"
                        value={p.value}
                        onChange={(e) => updatePath(i, 'value', e.target.value)}
                        className="flex-1 bg-canvas border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                      />
                      {paths.length > 1 && (
                        <button type="button" onClick={() => removePath(i)} className="text-muted hover:text-danger text-xs px-1">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 justify-end mt-1">
                  <button type="button" onClick={() => setShowModal(false)} className="text-muted text-sm px-3 py-1.5">Cancel</button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="bg-accent text-canvas text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}

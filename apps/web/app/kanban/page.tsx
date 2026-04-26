'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

export default function KanbanPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)

  // Create task form state
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newProject, setNewProject] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [creating, setCreating] = useState(false)

  const fetchTasks = useCallback(async (projectId?: string | null) => {
    try {
      const params = projectId ? { projectId } : undefined
      const data = await api.tasks.list(params)
      setTasks(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    api.projects.list().then(setProjects).catch(() => {})
  }, [])

  useEffect(() => {
    fetchTasks(activeProjectId)
  }, [fetchTasks, activeProjectId])

  const refresh = useCallback(() => {
    fetchTasks(activeProjectId)
  }, [fetchTasks, activeProjectId])

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      await api.tasks.create({
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        projectId: newProject || activeProjectId || undefined,
        priority: newPriority,
      })
      setNewTitle('')
      setNewDesc('')
      setNewProject('')
      setNewPriority('medium')
      setShowModal(false)
      refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const rootCount = tasks.filter((t) => !t.parentTaskId).length

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-[15px] font-semibold text-text tracking-tight">Kanban</h1>
              <p className="text-[13px] text-muted mt-0.5">{rootCount} tasks</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent text-[13px] font-semibold px-3 py-1.5 rounded transition-all"
            >
              + New task
            </button>
          </div>

          {/* Project filter bar */}
          <div className="flex items-center gap-1.5 mb-6 flex-wrap">
            <button
              onClick={() => setActiveProjectId(null)}
              className={`text-[13px] px-3 py-1 rounded border transition-all ${
                activeProjectId === null
                  ? 'bg-accent/15 border-accent/25 text-accent'
                  : 'border-border text-muted hover:text-text hover:border-border-hi'
              }`}
            >
              All
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProjectId(p.id)}
                className={`text-[13px] px-3 py-1 rounded border transition-all ${
                  activeProjectId === p.id
                    ? 'bg-accent/15 border-accent/25 text-accent'
                    : 'border-border text-muted hover:text-text hover:border-border-hi'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-muted text-[14px]"><span className="cursor-blink">▋</span> Loading…</p>
          ) : error ? (
            <p className="text-danger text-[14px]">✕ {error}</p>
          ) : (
            <KanbanBoard initialTasks={tasks} onRefresh={refresh} />
          )}
        </div>

        {/* Create task modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-border-hi rounded-xl w-full max-w-sm p-5 glow-border fade-up">
              <h2 className="text-[14px] font-semibold text-text mb-4">New task</h2>
              <form onSubmit={createTask} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Task title *"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-canvas border border-border text-text text-[14px] rounded px-3 py-2 placeholder-dim"
                  autoFocus
                  required
                />
                <textarea
                  placeholder="Description (optional)"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 placeholder-dim resize-none"
                />
                <select
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2"
                >
                  {['low', 'medium', 'high', 'urgent'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
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

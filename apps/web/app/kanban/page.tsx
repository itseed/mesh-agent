'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'
import { useTaskEvents } from '@/lib/ws'
import { PageLoader } from '@/components/ui/PageLoader'

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
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  useTaskEvents(useCallback(() => { fetchTasks(activeProjectId) }, [fetchTasks, activeProjectId]))

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const task = await api.tasks.create({
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        projectId: newProject || activeProjectId || undefined,
        priority: newPriority,
      })
      for (const file of pendingFiles) {
        try {
          const { uploadUrl } = await api.tasks.createAttachment(task.id, {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream',
          })
          await fetch(uploadUrl, { method: 'PUT', body: file })
        } catch {
          // best-effort: don't block task creation on upload failure
        }
      }
      setNewTitle('')
      setNewDesc('')
      setNewProject('')
      setNewPriority('medium')
      setPendingFiles([])
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
            <PageLoader />
          ) : error ? (
            <p className="text-danger text-[14px]">✕ {error}</p>
          ) : tasks.filter((t) => !t.parentTaskId).length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[14px] text-muted mb-1">ยังไม่มี task</p>
              <p className="text-[13px] text-dim">กดปุ่ม + New task เพื่อเริ่ม หรือพิมพ์ใน Lead chat ว่า &quot;สร้าง task ใหม่&quot;</p>
            </div>
          ) : (
            <KanbanBoard initialTasks={tasks} projects={projects} onRefresh={refresh} />
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

                {/* File drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length) setPendingFiles((prev) => [...prev, ...files])
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full border border-dashed rounded px-3 py-3 text-center cursor-pointer transition-colors text-[12px] ${
                    dragOver
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-dim hover:border-border-hi hover:text-muted'
                  }`}
                >
                  Drop files here or click to attach
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      if (files.length) setPendingFiles((prev) => [...prev, ...files])
                      e.target.value = ''
                    }}
                  />
                </div>

                {pendingFiles.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {pendingFiles.map((f, i) => (
                      <li key={i} className="flex items-center justify-between text-[12px] text-muted bg-canvas border border-border rounded px-2 py-1">
                        <span className="truncate max-w-[200px]">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-dim hover:text-danger ml-2 shrink-0"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

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
                    onClick={() => { setShowModal(false); setPendingFiles([]) }}
                    className="text-muted text-[14px] px-3 py-1.5 hover:text-text transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    {creating ? '…' : pendingFiles.length > 0 ? `Create + ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''}` : 'Create'}
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

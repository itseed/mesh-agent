'use client'
import { useState, useEffect, useCallback } from 'react'
import { TopNav } from '@/components/layout/TopNav'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function KanbanPage() {
  const { token } = useAuth()
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchTasks = useCallback(async () => {
    if (!token) return
    try {
      const data = await api.tasks.list(token)
      setTasks(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !newTitle.trim()) return
    setCreating(true)
    try {
      await api.tasks.create(token, { title: newTitle.trim() })
      setNewTitle('')
      setShowModal(false)
      fetchTasks()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas">
        <TopNav />
        <main className="p-6 pb-24">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg font-semibold">Kanban</h1>
            <button
              onClick={() => setShowModal(true)}
              className="bg-accent text-canvas text-xs font-semibold px-3 py-1.5 rounded-lg"
            >
              + New Task
            </button>
          </div>
          {loading ? (
            <p className="text-muted text-sm">Loading tasks...</p>
          ) : error ? (
            <p className="text-danger text-sm">{error}</p>
          ) : (
            <KanbanBoard initialTasks={tasks} />
          )}
        </main>
        {showModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-6">
              <h2 className="text-sm font-semibold mb-4">New Task</h2>
              <form onSubmit={createTask} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Task title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="bg-canvas border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  autoFocus
                  required
                />
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="text-muted text-sm px-3 py-1.5"
                  >
                    Cancel
                  </button>
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

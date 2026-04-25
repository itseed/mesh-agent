'use client'
import { useState, useEffect, useCallback } from 'react'
import { TopNav } from '@/components/layout/TopNav'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function OverviewPage() {
  const { token } = useAuth()
  const [agents, setAgents] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const [agentsData, tasksData] = await Promise.all([
        api.agents.list(token),
        api.tasks.list(token),
      ])
      setAgents(agentsData)
      setTasks(tasksData)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  const runningAgents = agents.filter((a) => a.status === 'running').length
  const byStage = (stage: string) => tasks.filter((t) => t.stage === stage).length
  const recent = [...tasks].sort((a, b) =>
    new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
    new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
  ).slice(0, 5)

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas">
        <TopNav />
        <main className="p-6 pb-24">
          <h1 className="text-lg font-semibold mb-6">Overview</h1>
          {error && <p className="text-danger text-sm mb-4">{error}</p>}
          {loading ? (
            <p className="text-muted text-sm">Loading...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-surface border border-border rounded-xl p-4">
                  <h2 className="text-sm font-medium mb-3 text-muted">Agents</h2>
                  <p className="text-2xl font-bold text-success">{runningAgents}</p>
                  <p className="text-xs text-muted mt-1">running · {agents.length} total</p>
                </div>
                <div className="bg-surface border border-border rounded-xl p-4">
                  <h2 className="text-sm font-medium mb-3 text-muted">Tasks</h2>
                  <div className="flex gap-4 text-sm">
                    <div>
                      <span className="font-bold">{byStage('backlog')}</span>{' '}
                      <span className="text-muted text-xs">backlog</span>
                    </div>
                    <div>
                      <span className="font-bold text-warning">{byStage('in_progress')}</span>{' '}
                      <span className="text-muted text-xs">in progress</span>
                    </div>
                    <div>
                      <span className="font-bold text-success">{byStage('done')}</span>{' '}
                      <span className="text-muted text-xs">done</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted mt-2">{tasks.length} total</p>
                </div>
                <div className="bg-surface border border-border rounded-xl p-4">
                  <h2 className="text-sm font-medium mb-3 text-muted">GitHub</h2>
                  <p className="text-xs text-muted">Go to Projects to link a GitHub repo</p>
                </div>
              </div>
              <div className="mt-6 bg-surface border border-border rounded-xl p-4">
                <h2 className="text-sm font-medium mb-3 text-muted">Recent Activity</h2>
                {recent.length === 0 ? (
                  <p className="text-xs text-muted">No recent activity</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recent.map((task) => (
                      <div key={task.id} className="flex items-center justify-between text-sm">
                        <span className="text-white truncate max-w-xs">{task.title}</span>
                        <span className={`text-xs ml-4 shrink-0 ${
                          task.stage === 'done' ? 'text-success' :
                          task.stage === 'in_progress' ? 'text-warning' :
                          task.stage === 'review' ? 'text-purple' : 'text-muted'
                        }`}>{task.stage}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}

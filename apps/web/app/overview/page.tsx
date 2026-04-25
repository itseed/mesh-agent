'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

const STAGE_COLOR: Record<string, string> = {
  backlog: 'text-muted',
  in_progress: 'text-warning',
  review: 'text-purple',
  done: 'text-success',
}

const STAGE_DOT: Record<string, string> = {
  backlog: '#3d4f61',
  in_progress: '#f0883e',
  review: '#d2a8ff',
  done: '#3fb950',
}

export default function OverviewPage() {
  const [agents, setAgents] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [agentsData, tasksData] = await Promise.all([api.agents.list(), api.tasks.list()])
      setAgents(agentsData)
      setTasks(tasksData)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const running = agents.filter((a) => a.status === 'running').length
  const byStage = (s: string) => tasks.filter((t) => t.stage === s).length
  const recent = [...tasks]
    .sort((a, b) =>
      new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
      new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
    )
    .slice(0, 6)

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          {/* Header */}
          <div className="mb-7">
            <h1 className="text-[15px] font-semibold text-text tracking-tight">Overview</h1>
            <p className="text-[13px] text-muted mt-0.5">System status at a glance</p>
          </div>

          {error && <p className="text-danger text-[14px] mb-4">✕ {error}</p>}

          {loading ? (
            <p className="text-muted text-[14px]">
              <span className="cursor-blink">▋</span> Loading…
            </p>
          ) : (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'Agents running', value: running, color: running > 0 ? 'text-success' : 'text-muted', dot: running > 0 ? '#3fb950' : undefined },
                  { label: 'Total agents', value: agents.length, color: 'text-text' },
                  { label: 'In progress', value: byStage('in_progress'), color: 'text-warning' },
                  { label: 'Tasks done', value: byStage('done'), color: 'text-success' },
                ].map((s) => (
                  <div key={s.label} className="bg-surface border border-border rounded-lg p-4">
                    <div className={`text-2xl font-semibold ${s.color} leading-none`}>{s.value}</div>
                    <div className="text-[13px] text-muted mt-1.5">{s.label}</div>
                    {s.dot && running > 0 && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="relative inline-flex w-2 h-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: s.dot }} />
                          <span className="relative inline-flex w-2 h-2 rounded-full" style={{ backgroundColor: s.dot }} />
                        </span>
                        <span className="text-[12px] text-muted">live</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Two columns: tasks breakdown + recent activity */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                {/* Task stage breakdown */}
                <div className="lg:col-span-2 bg-surface border border-border rounded-lg p-4">
                  <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-3">Tasks by stage</div>
                  <div className="flex flex-col gap-2.5">
                    {(['backlog', 'in_progress', 'review', 'done'] as const).map((stage) => {
                      const count = byStage(stage)
                      const pct = tasks.length > 0 ? Math.round((count / tasks.length) * 100) : 0
                      return (
                        <div key={stage}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STAGE_DOT[stage] }} />
                              <span className="text-[13px] text-muted capitalize">{stage.replace('_', ' ')}</span>
                            </div>
                            <span className={`text-[14px] font-medium ${STAGE_COLOR[stage]}`}>{count}</span>
                          </div>
                          <div className="h-0.5 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: STAGE_DOT[stage] }}
                            />
                          </div>
                        </div>
                      )
                    })}
                    <div className="mt-1 pt-2 border-t border-border text-[13px] text-muted">
                      {tasks.length} total tasks
                    </div>
                  </div>
                </div>

                {/* Recent activity */}
                <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-4">
                  <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-3">Recent activity</div>
                  {recent.length === 0 ? (
                    <p className="text-[14px] text-dim">No tasks yet. Create one in Kanban.</p>
                  ) : (
                    <div className="flex flex-col divide-y divide-border">
                      {recent.map((task) => (
                        <div key={task.id} className="flex items-center justify-between py-2 gap-3">
                          <span className="text-[14px] text-text truncate">{task.title}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STAGE_DOT[task.stage] ?? '#3d4f61' }} />
                            <span className={`text-[12px] ${STAGE_COLOR[task.stage] ?? 'text-muted'}`}>
                              {task.stage?.replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  )
}

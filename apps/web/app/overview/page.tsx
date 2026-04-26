'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

const STAGE_DOT: Record<string, string> = {
  backlog: '#3d4f61',
  in_progress: '#f0883e',
  review: '#d2a8ff',
  done: '#3fb950',
}

const STAGE_COLOR: Record<string, string> = {
  backlog: '#6a7a8e',
  in_progress: '#f0883e',
  review: '#d2a8ff',
  done: '#3fb950',
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#374556',
}

const STEPS = [
  { num: '1', label: 'สร้าง Project', desc: 'เพิ่ม GitHub repos + กำหนด paths', href: '/projects', color: '#58a6ff' },
  { num: '2', label: 'สร้าง Task', desc: 'อธิบายงานที่ต้องการ + ระบุ priority', href: '/kanban', color: '#d2a8ff' },
  { num: '3', label: 'AI วิเคราะห์', desc: 'Lead แตก task เป็น subtasks ให้', href: '/kanban', color: '#f0883e' },
  { num: '4', label: 'Agents ทำงาน', desc: 'แต่ละ agent รับ subtask ไปทำ', href: '/agents', color: '#3fb950' },
]

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

export default function OverviewPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [p, t, a] = await Promise.all([
        api.projects.list(),
        api.tasks.list(),
        api.agents.list(),
      ])
      setProjects(p)
      setTasks(t)
      setAgents(a)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const activeProject = projects.find((p: any) => p.isActive)
  const running = agents.filter((a: any) => a.status === 'running').length
  const inProgress = tasks.filter((t: any) => t.stage === 'in_progress').length
  const done = tasks.filter((t: any) => t.stage === 'done').length
  const urgentHighCount = tasks.filter(
    (t: any) => t.stage === 'in_progress' && (t.priority === 'high' || t.priority === 'urgent')
  ).length

  const recent = [...tasks]
    .sort((a, b) =>
      new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
      new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
    )
    .slice(0, 8)

  const byStage = (s: string) => tasks.filter((t: any) => t.stage === s).length
  const byPriority = (p: string) => tasks.filter((t: any) => t.priority === p).length

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          <div className="mb-7">
            <h1 className="text-[15px] font-semibold text-text tracking-tight">Overview</h1>
            <p className="text-[13px] text-muted mt-0.5">System status at a glance</p>
          </div>

          {error && <p className="text-danger text-[14px] mb-4">✕ {error}</p>}

          {loading ? (
            <p className="text-muted text-[14px]"><span className="cursor-blink">▋</span> Loading…</p>
          ) : (
            <>
              {/* Workflow Guide */}
              <div className="mb-6 bg-surface border border-border rounded-xl p-4">
                <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-3">Workflow</div>
                <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
                  {STEPS.map((step, i) => (
                    <Fragment key={step.num}>
                      <a href={step.href} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                          style={{ backgroundColor: step.color + '20', color: step.color, border: '1px solid ' + step.color + '40' }}
                        >
                          {step.num}
                        </span>
                        <div>
                          <div className="text-[13px] font-semibold text-text">{step.label}</div>
                          <div className="text-[12px] text-muted">{step.desc}</div>
                        </div>
                      </a>
                      {i < STEPS.length - 1 && (
                        <span className="hidden lg:block text-dim text-[16px]">→</span>
                      )}
                    </Fragment>
                  ))}
                </div>
              </div>

              {/* Row 1: 5 stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                {/* Active Project */}
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-[20px] font-semibold text-text leading-none truncate">
                    {activeProject
                      ? activeProject.name
                      : <span className="text-dim text-[16px]">None</span>
                    }
                  </div>
                  <div className="text-[13px] text-muted mt-1.5">Active project</div>
                  {activeProject?.githubRepos?.length > 0 && (
                    <div className="text-[12px] text-dim mt-1">{activeProject.githubRepos.length} repo{activeProject.githubRepos.length !== 1 ? 's' : ''}</div>
                  )}
                </div>

                {/* Total Tasks */}
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-2xl font-semibold text-text leading-none">{tasks.length}</div>
                  <div className="text-[13px] text-muted mt-1.5">Total tasks</div>
                </div>

                {/* In Progress */}
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-2xl font-semibold leading-none" style={{ color: '#f0883e' }}>{inProgress}</div>
                  <div className="text-[13px] text-muted mt-1.5">In progress</div>
                  {urgentHighCount > 0 && (
                    <div className="text-[12px] mt-1" style={{ color: '#fb923c' }}>{urgentHighCount} urgent/high</div>
                  )}
                </div>

                {/* Done */}
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-2xl font-semibold text-success leading-none">{done}</div>
                  <div className="text-[13px] text-muted mt-1.5">Done</div>
                </div>

                {/* Agents Running */}
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-2xl font-semibold leading-none" style={{ color: running > 0 ? '#3fb950' : '#6a7a8e' }}>
                    {running}
                  </div>
                  <div className="text-[13px] text-muted mt-1.5">Agents running</div>
                  {running > 0 && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="relative inline-flex w-2 h-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
                        <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
                      </span>
                      <span className="text-[12px] text-muted">live</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Pipeline (3) + Recent activity (2) */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-4">
                {/* Task Pipeline */}
                <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-4">
                  <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-3">Task Pipeline</div>

                  {/* Stage breakdown */}
                  <div className="flex flex-col gap-2.5 mb-4">
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
                            <span className="text-[14px] font-medium" style={{ color: STAGE_COLOR[stage] }}>{count}</span>
                          </div>
                          <div className="h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: STAGE_DOT[stage] }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Priority breakdown */}
                  <div className="border-t border-border pt-3">
                    <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-2.5">By Priority</div>
                    <div className="flex flex-col gap-2">
                      {(['urgent', 'high', 'medium', 'low'] as const).map((priority) => {
                        const count = byPriority(priority)
                        const pct = tasks.length > 0 ? Math.round((count / tasks.length) * 100) : 0
                        return (
                          <div key={priority}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PRIORITY_DOT[priority] }} />
                                <span className="text-[13px] text-muted capitalize">{priority}</span>
                              </div>
                              <span className="text-[14px] font-medium" style={{ color: PRIORITY_DOT[priority] }}>{count}</span>
                            </div>
                            <div className="h-1.5 bg-border rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: PRIORITY_DOT[priority] }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-border text-[13px] text-muted">
                    {tasks.length} total tasks
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="lg:col-span-2 bg-surface border border-border rounded-lg p-4">
                  <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-3">Recent Activity</div>
                  {recent.length === 0 ? (
                    <p className="text-[14px] text-dim">No tasks yet.</p>
                  ) : (
                    <div className="flex flex-col divide-y divide-border">
                      {recent.map((task: any) => (
                        <div key={task.id} className="py-2 flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {task.priority && (
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_DOT[task.priority] ?? '#374556' }} />
                            )}
                            <span className="text-[13px] text-text truncate flex-1">{task.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                              style={{
                                color: STAGE_COLOR[task.stage] ?? '#6a7a8e',
                                backgroundColor: `${STAGE_DOT[task.stage] ?? '#3d4f61'}20`,
                              }}
                            >
                              {task.stage?.replace('_', ' ')}
                            </span>
                            {(task.updatedAt || task.createdAt) && (
                              <span className="text-[11px] text-dim">
                                {relativeTime(task.updatedAt ?? task.createdAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Empty state */}
              {tasks.length === 0 && (
                <div className="bg-surface border border-border rounded-lg p-8 text-center">
                  <p className="text-[15px] font-medium text-text mb-1">ยังไม่มี task</p>
                  <p className="text-[13px] text-muted mb-4">สร้าง task แรกใน Kanban เพื่อเริ่มต้น</p>
                  <Link
                    href="/kanban"
                    className="inline-flex items-center gap-1.5 bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent text-[13px] font-semibold px-4 py-2 rounded transition-all"
                  >
                    ไปที่ Kanban →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  )
}

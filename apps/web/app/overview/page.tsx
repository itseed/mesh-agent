'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

const ROLE_DOT: Record<string, string> = {
  frontend: '#22d3ee',
  backend: '#60a5fa',
  mobile: '#c084fc',
  devops: '#4ade80',
  designer: '#f472b6',
  qa: '#fb923c',
  reviewer: '#f87171',
  lead: '#facc15',
}

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
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function DonutChart({ segments }: {
  segments: { label: string; count: number; color: string }[]
}) {
  const total = segments.reduce((s, x) => s + x.count, 0)
  const r = 40
  const cx = 60
  const cy = 60
  const circumference = 2 * Math.PI * r

  let offset = 0
  const arcs = segments.map((seg) => {
    const pct = total > 0 ? seg.count / total : 0
    const dash = pct * circumference
    const arc = { ...seg, dash, gap: circumference - dash, offset, pct }
    offset += dash
    return arc
  })

  return (
    <div className="flex items-center gap-6">
      <div className="shrink-0">
        <svg width="120" height="120" viewBox="0 0 120 120">
          {total === 0 ? (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="12" />
          ) : (
            arcs.map((arc) => (
              arc.count === 0 ? null : (
                <circle
                  key={arc.label}
                  cx={cx} cy={cy} r={r}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="12"
                  strokeDasharray={`${arc.dash} ${arc.gap}`}
                  strokeDashoffset={-arc.offset}
                  style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
                />
              )
            ))
          )}
          <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 20, fontWeight: 600, fill: 'var(--color-text)' }}>
            {total}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--color-muted)' }}>
            tasks
          </text>
        </svg>
      </div>
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.count / total) * 100) : 0
          return (
            <div key={seg.label} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="text-[12px] text-muted capitalize flex-1">{seg.label.replace('_', ' ')}</span>
              <span className="text-[13px] font-medium" style={{ color: seg.color }}>{seg.count}</span>
              <span className="text-[11px] text-dim w-8 text-right">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function OverviewPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [metrics, setMetrics] = useState<any>(null)
  const [tokenStats, setTokenStats] = useState<{ inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [p, t, a, m, tok] = await Promise.all([
        api.projects.list(),
        api.tasks.list(),
        api.agents.list(),
        api.agents.metrics(24 * 7),
        api.metrics.tokens(),
      ])
      setProjects(p)
      setTasks(t)
      setAgents(a)
      setMetrics(m)
      setTokenStats(tok)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

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

  const totalSessions = metrics?.totals?.count ?? 0
  const successSessions = metrics?.totals?.successCount ?? 0
  const successRate = totalSessions > 0 ? Math.round((successSessions / totalSessions) * 100) : 0
  const perRole: Array<{ role: string; count: number; successCount: number; avgDurationMs: number }> =
    metrics?.perRole ?? []
  const topRole = [...perRole].sort((a, b) => b.count - a.count)[0] ?? null
  const totalAvgMs = perRole.length > 0
    ? Math.round(perRole.reduce((s, r) => s + r.avgDurationMs * r.count, 0) / Math.max(totalSessions, 1))
    : 0

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          <div className="mb-7">
            <h1 className="text-[15px] font-semibold text-text tracking-tight">Overview</h1>
            <p className="text-[13px] text-muted mt-0.5">ภาพรวมระบบ — projects, tasks, agents</p>
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
                {/* Projects */}
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-2xl font-semibold text-text leading-none">{projects.length}</div>
                  <div className="text-[13px] text-muted mt-1.5">Projects</div>
                  {projects.length > 0 && (
                    <div className="text-[12px] text-dim mt-1">
                      {projects.reduce((sum: number, p: any) => sum + (p.githubRepos?.length ?? 0), 0)} repos linked
                    </div>
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

              {/* AI Activity — unified card */}
              {(metrics || tokenStats) && (
                <div className="bg-surface border border-border rounded-xl mb-6 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                      <span className="text-[12px] font-semibold text-muted uppercase tracking-wider">AI Activity</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-dim">7 days</span>
                      {totalSessions > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: '#3fb95015', color: '#3fb950', border: '1px solid #3fb95030' }}>
                          {successRate}% success
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-border">
                    {/* Left: agent session stats + role breakdown */}
                    <div className="lg:col-span-3 p-5">
                      {totalSessions === 0 ? (
                        <p className="text-[13px] text-dim">ยังไม่มี session — dispatch agent เพื่อเริ่ม</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-4 gap-3 mb-5">
                            {[
                              { label: 'Sessions', value: String(totalSessions), color: 'var(--color-text)' },
                              { label: 'Completed', value: String(successSessions), color: '#3fb950' },
                              {
                                label: 'Avg time',
                                value: totalAvgMs > 60000
                                  ? `${(totalAvgMs / 60000).toFixed(1)}m`
                                  : `${(totalAvgMs / 1000).toFixed(0)}s`,
                                color: 'var(--color-text)',
                              },
                              { label: 'Top role', value: topRole?.role ?? '—', color: topRole ? (ROLE_DOT[topRole.role] ?? '#6a7a8e') : '#6a7a8e' },
                            ].map(({ label, value, color }) => (
                              <div key={label} className="bg-canvas rounded-lg px-3 py-2.5 border border-border">
                                <div className="text-[18px] font-semibold leading-none truncate" style={{ color }}>{value}</div>
                                <div className="text-[11px] text-dim mt-1.5">{label}</div>
                              </div>
                            ))}
                          </div>

                          {perRole.length > 0 && (
                            <div className="flex flex-col gap-2.5">
                              {[...perRole].sort((a, b) => b.count - a.count).map((r) => {
                                const pct = totalSessions > 0 ? Math.round((r.count / totalSessions) * 100) : 0
                                const color = ROLE_DOT[r.role] ?? '#6a7a8e'
                                return (
                                  <div key={r.role}>
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                        <span className="text-[12px] text-muted">{r.role}</span>
                                      </div>
                                      <div className="flex items-center gap-2.5">
                                        <span className="text-[11px] text-dim">{r.count} sessions</span>
                                        <span className="text-[11px] font-medium w-7 text-right" style={{ color }}>{pct}%</span>
                                      </div>
                                    </div>
                                    <div className="h-1 bg-border rounded-full overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all duration-700"
                                        style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }}
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Right: Lead token stats */}
                    <div className="lg:col-span-2 p-5 flex flex-col">
                      <div className="text-[11px] font-semibold text-dim uppercase tracking-wider mb-4">Lead AI — tokens (all time)</div>
                      {tokenStats && tokenStats.totalTokens > 0 ? (
                        <>
                          <div className="flex-1 flex flex-col gap-3">
                            {/* Total tokens — primary */}
                            <div className="bg-canvas rounded-lg border border-border px-4 py-3">
                              <div className="text-[28px] font-bold text-text leading-none">
                                {tokenStats.totalTokens >= 1000000
                                  ? `${(tokenStats.totalTokens / 1000000).toFixed(2)}M`
                                  : tokenStats.totalTokens >= 1000
                                  ? `${(tokenStats.totalTokens / 1000).toFixed(1)}K`
                                  : String(tokenStats.totalTokens)}
                              </div>
                              <div className="text-[11px] text-muted mt-1">Total tokens used</div>
                              {/* input/output mini bars */}
                              <div className="mt-3 flex gap-1.5 h-1 rounded-full overflow-hidden">
                                <div
                                  className="rounded-l-full bg-accent/50"
                                  style={{ flex: tokenStats.inputTokens }}
                                />
                                <div
                                  className="rounded-r-full"
                                  style={{ flex: tokenStats.outputTokens, backgroundColor: '#3fb95070' }}
                                />
                              </div>
                              <div className="flex items-center gap-3 mt-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-accent/50" />
                                  <span className="text-[10px] text-dim">
                                    In: {tokenStats.inputTokens >= 1000 ? `${(tokenStats.inputTokens / 1000).toFixed(1)}K` : tokenStats.inputTokens}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#3fb95070' }} />
                                  <span className="text-[10px] text-dim">
                                    Out: {tokenStats.outputTokens >= 1000 ? `${(tokenStats.outputTokens / 1000).toFixed(1)}K` : tokenStats.outputTokens}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Cost */}
                            <div className="bg-canvas rounded-lg border border-border px-4 py-3 flex items-center justify-between">
                              <div>
                                <div className="text-[22px] font-semibold leading-none" style={{ color: '#facc15' }}>
                                  ${tokenStats.costUsd < 0.001 && tokenStats.costUsd > 0
                                    ? tokenStats.costUsd.toFixed(5)
                                    : tokenStats.costUsd.toFixed(4)}
                                </div>
                                <div className="text-[11px] text-muted mt-1">Lead cost (USD)</div>
                              </div>
                              <div className="text-[24px] opacity-20 select-none">$</div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="text-[13px] text-dim">ยังไม่มีข้อมูล — เริ่มส่งข้อความใน Chat</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Row 2: Pipeline (3) + Recent activity (2) */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-4">
                {/* Task Pipeline */}
                <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-4">
                  <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-4">Task Pipeline</div>

                  <DonutChart
                    segments={[
                      { label: 'backlog',     count: byStage('backlog'),     color: '#6a7a8e' },
                      { label: 'in_progress', count: byStage('in_progress'), color: '#f0883e' },
                      { label: 'review',      count: byStage('review'),      color: '#d2a8ff' },
                      { label: 'done',        count: byStage('done'),        color: '#3fb950' },
                    ]}
                  />

                  <div className="border-t border-border pt-3 mt-4">
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
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium" style={{ color: PRIORITY_DOT[priority] }}>{count}</span>
                                <span className="text-[11px] text-dim w-8 text-right">{pct}%</span>
                              </div>
                            </div>
                            <div className="h-2 bg-border rounded-full overflow-hidden">
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

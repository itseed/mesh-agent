'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AgentGrid } from '@/components/agents/AgentGrid'
import { AgentOutputPanel } from '@/components/agents/AgentOutputPanel'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

const HIST_STATUS_STYLE: Record<string, { color: string; label: string }> = {
  completed: { color: '#3fb950', label: 'done' },
  errored:   { color: '#f87171', label: 'error' },
  killed:    { color: '#6a7a8e', label: 'stopped' },
  running:   { color: '#f0883e', label: 'running' },
  pending:   { color: '#fbbf24', label: 'pending' },
}

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return 'just now'
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago'
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago'
  return Math.floor(d / 86400000) + 'd ago'
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [outputPanel, setOutputPanel] = useState<{ id: string; role: string } | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      const [data, hist, roleList, projectList] = await Promise.all([
        api.agents.list(),
        api.agents.history(20),
        api.agents.listRoles(),
        api.projects.list(),
      ])
      setAgents(data)
      setHistory(hist)
      setRoles(roleList)
      setProjects(projectList)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAgents()
    const id = setInterval(fetchAgents, 5000)
    return () => clearInterval(id)
  }, [fetchAgents])

  const running = agents.filter(
    (a) => a.status === 'running' || a.status === 'pending',
  ).length

  const historySection = history.length > 0 && (
    <div className="mt-8">
      <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-3">Recent Sessions</div>
      <div className="flex flex-col gap-1.5">
        {history.map((s: any) => {
          const st = HIST_STATUS_STYLE[s.status] ?? { color: '#6a7a8e', label: s.status }
          return (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 bg-surface border border-border rounded-lg hover:border-border-hi transition-colors">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: st.color }} />
              <span className="text-[12px] font-mono bg-surface-2 border border-border px-1.5 py-0.5 rounded text-muted shrink-0">{s.role}</span>
              <span className="text-[13px] text-text truncate flex-1">
                {s.prompt?.slice(0, 80)}{s.prompt?.length > 80 ? '…' : ''}
              </span>
              <span className="text-[12px] shrink-0 font-medium" style={{ color: st.color }}>{st.label}</span>
              {s.durationMs && (
                <span className="text-[12px] text-dim shrink-0">{(s.durationMs / 1000).toFixed(1)}s</span>
              )}
              <span className="text-[12px] text-dim shrink-0">{relTime(s.createdAt)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-[15px] font-semibold text-text tracking-tight">Agents</h1>
              <p className="text-[13px] text-muted mt-0.5">
                {running > 0
                  ? <>{running} running · {agents.length} total</>
                  : <>{agents.length} total — none running</>
                }
              </p>
            </div>
            {running > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="relative inline-flex w-2 h-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-50" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
                </span>
                <span className="text-[13px] text-success">{running} active</span>
              </div>
            )}
          </div>

          {loading ? (
            <p className="text-muted text-[14px]"><span className="cursor-blink">▋</span> Loading…</p>
          ) : error ? (
            <p className="text-danger text-[14px]">✕ {error}</p>
          ) : (
            <>
              {agents.length === 0 && (
                <div className="mb-4">
                  <p className="text-[14px] text-muted">ยังไม่มี agent ทำงานอยู่</p>
                  <p className="text-[13px] text-dim mt-1">เปิด task ใน Kanban → กด Analyze → Approve แผน เพื่อเริ่ม dispatch agents</p>
                </div>
              )}
              <AgentGrid
                agents={agents}
                roles={roles}
                history={history}
                projects={projects}
                onRefresh={fetchAgents}
                onViewOutput={(id, role) => setOutputPanel({ id, role })}
              />
              {historySection}
            </>
          )}
        </div>
      {outputPanel && (
        <AgentOutputPanel
          sessionId={outputPanel.id}
          role={outputPanel.role}
          onClose={() => setOutputPanel(null)}
        />
      )}
    </AppShell>
    </AuthGuard>
  )
}

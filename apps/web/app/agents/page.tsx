'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { AgentGrid } from '@/components/agents/AgentGrid'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export default function AgentsPage() {
  const { token } = useAuth()
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAgents = useCallback(async () => {
    if (!token) return
    try {
      const data = await api.agents.list(token)
      setAgents(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchAgents()
    const id = setInterval(fetchAgents, 5000)
    return () => clearInterval(id)
  }, [fetchAgents])

  const running = agents.filter((a) => a.status === 'running').length

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
            <AgentGrid agents={agents} />
          )}
        </div>
      </AppShell>
    </AuthGuard>
  )
}

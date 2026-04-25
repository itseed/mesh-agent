'use client'
import { useState, useEffect, useCallback } from 'react'
import { TopNav } from '@/components/layout/TopNav'
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
    const interval = setInterval(fetchAgents, 5000)
    return () => clearInterval(interval)
  }, [fetchAgents])

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas">
        <TopNav />
        <main className="p-6 pb-24">
          <h1 className="text-lg font-semibold mb-6">Agents</h1>
          {loading ? (
            <p className="text-muted text-sm">Loading agents...</p>
          ) : error ? (
            <p className="text-danger text-sm">{error}</p>
          ) : (
            <AgentGrid agents={agents} />
          )}
        </main>
      </div>
    </AuthGuard>
  )
}

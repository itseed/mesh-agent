'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const AGENT_ROLES = ['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer']

export function CommandBar() {
  const { token } = useAuth()
  const [role, setRole] = useState('frontend')
  const [prompt, setPrompt] = useState('')
  const [workingDir, setWorkingDir] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)

  async function dispatch() {
    if (!token || !prompt.trim()) return
    setLoading(true)
    try {
      await api.agents.dispatch(token, { role, workingDir: workingDir || '/tmp', prompt })
      setPrompt('')
      setExpanded(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border p-3 z-30">
      {expanded ? (
        <div className="max-w-2xl mx-auto flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">New Task</span>
            <button onClick={() => setExpanded(false)} className="text-muted hover:text-white text-sm">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-canvas border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            >
              {AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <input
              type="text"
              placeholder="Working directory"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              className="bg-canvas border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <textarea
            placeholder="Describe the task for the agent..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="bg-canvas border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none"
          />
          <button
            onClick={dispatch}
            disabled={loading || !prompt.trim()}
            className="bg-success text-canvas font-semibold py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? 'Dispatching...' : `Assign to ${role} →`}
          </button>
        </div>
      ) : (
        <div className="max-w-2xl mx-auto flex gap-2 items-center">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="bg-canvas border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
          >
            {AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input
            type="text"
            placeholder="Quick command..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && dispatch()}
            className="flex-1 bg-canvas border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
          <button
            onClick={() => setExpanded(true)}
            className="text-muted hover:text-white text-xs px-2"
            title="Expand"
          >⤢</button>
          <button
            onClick={dispatch}
            disabled={loading || !prompt.trim()}
            className="bg-accent text-canvas text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}

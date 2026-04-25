'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const ROLES = ['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer']

const ROLE_DOT: Record<string, string> = {
  frontend: '#22d3ee',
  backend: '#60a5fa',
  mobile: '#c084fc',
  devops: '#4ade80',
  designer: '#f472b6',
  qa: '#fb923c',
  reviewer: '#f87171',
}

export function CommandBar() {
  const pathname = usePathname()
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

  if (pathname === '/login') return null

  const inputBase = 'bg-canvas/80 border border-border text-text text-[14px] rounded px-3 py-1.5 placeholder-dim transition-colors focus:border-accent/60'

  return (
    <div className="fixed bottom-0 left-14 lg:left-[216px] right-0 z-30 border-t border-border/80 backdrop-blur-md bg-surface/90">


      {expanded ? (
        <div className="max-w-2xl mx-auto p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full inline-block shrink-0"
                style={{ backgroundColor: ROLE_DOT[role] ?? '#6a7a8e' }}
              />
              <span className="text-[13px] font-medium text-text">Dispatch agent</span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="text-muted hover:text-text text-[13px] transition-colors"
            >
              ✕ collapse
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputBase}
            >
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <input
              type="text"
              placeholder="Working directory"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              className={inputBase}
            />
          </div>

          <textarea
            placeholder="Describe the task…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className={`${inputBase} resize-none w-full`}
          />

          <button
            onClick={dispatch}
            disabled={loading || !prompt.trim()}
            className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold py-1.5 rounded transition-colors disabled:opacity-40"
          >
            {loading ? 'Dispatching…' : `→ assign to ${role}`}
          </button>
        </div>
      ) : (
        <div className="max-w-2xl mx-auto px-3 py-2 flex gap-2 items-center">
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: ROLE_DOT[role] ?? '#6a7a8e' }}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-transparent text-muted text-[13px] border-none focus:outline-none cursor-pointer"
            >
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <input
            type="text"
            placeholder="Quick task…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && dispatch()}
            className={`${inputBase} flex-1`}
          />
          <button
            onClick={() => setExpanded(true)}
            className="text-dim hover:text-muted text-[12px] px-1 transition-colors"
            title="Expand"
          >
            ⤢
          </button>
          <button
            onClick={dispatch}
            disabled={loading || !prompt.trim()}
            className="bg-accent/20 hover:bg-accent/30 border border-accent/30 text-accent text-[13px] font-semibold px-3 py-1.5 rounded transition-colors disabled:opacity-40"
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      )}
    </div>
  )
}

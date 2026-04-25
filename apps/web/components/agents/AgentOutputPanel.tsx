'use client'
import { useAgentOutput } from '@/lib/ws'

const ROLE_COLOR: Record<string, string> = {
  frontend: '#22d3ee',
  backend:  '#60a5fa',
  mobile:   '#c084fc',
  devops:   '#4ade80',
  designer: '#f472b6',
  qa:       '#fb923c',
  reviewer: '#f87171',
}

interface AgentOutputPanelProps {
  sessionId: string
  role: string
  onClose: () => void
}

export function AgentOutputPanel({ sessionId, role, onClose }: AgentOutputPanelProps) {
  const lines = useAgentOutput(sessionId)
  const roleColor = ROLE_COLOR[role] ?? '#6a7a8e'

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border-hi rounded-xl w-full max-w-2xl max-h-[75vh] flex flex-col overflow-hidden glow-border fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-canvas/50">
          <div className="flex items-center gap-2.5">
            <div className="flex gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-danger/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-warning/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
            </div>
            <span className="text-[14px] font-medium" style={{ color: roleColor }}>{role}</span>
            <span className="text-[13px] text-dim">— live output</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-[14px] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] text-muted leading-relaxed scanlines bg-canvas/30">
          {lines.length === 0 ? (
            <span className="text-dim">
              Waiting for output<span className="cursor-blink">▋</span>
            </span>
          ) : (
            lines.map((line: string, i: number) => (
              <div key={i} className="py-0.5 border-b border-border/30 last:border-0">
                {line}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-[12px] text-dim flex items-center justify-between">
          <span>{lines.length} lines</span>
          <span>session: {sessionId.slice(0, 8)}…</span>
        </div>
      </div>
    </div>
  )
}

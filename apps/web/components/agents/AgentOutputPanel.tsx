'use client'
import { useAgentOutput } from '@/lib/ws'

interface AgentOutputPanelProps {
  sessionId: string
  role: string
  onClose: () => void
}

export function AgentOutputPanel({ sessionId, role, onClose }: AgentOutputPanelProps) {
  const lines = useAgentOutput(sessionId)

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="font-semibold text-sm">{role} — live output</span>
          <button onClick={onClose} className="text-muted hover:text-white text-sm">✕ close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-muted space-y-0.5">
          {lines.length === 0 ? (
            <span className="text-border">Waiting for output...</span>
          ) : (
            lines.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      </div>
    </div>
  )
}

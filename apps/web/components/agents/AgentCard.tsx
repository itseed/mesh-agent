const ROLE_COLOR: Record<string, string> = {
  frontend: '#22d3ee',
  backend:  '#60a5fa',
  mobile:   '#c084fc',
  devops:   '#4ade80',
  designer: '#f472b6',
  qa:       '#fb923c',
  reviewer: '#f87171',
}

interface AgentCardProps {
  agent: { id: string; role: string; status: string }
  recentLines: string[]
  onClick: () => void
}

export function AgentCard({ agent, recentLines, onClick }: AgentCardProps) {
  const roleColor = ROLE_COLOR[agent.role] ?? '#6a7a8e'
  const isRunning = agent.status === 'running'
  const isError = agent.status === 'error'

  return (
    <button
      onClick={onClick}
      className="bg-surface border border-border rounded-lg text-left hover:border-border-hi transition-all w-full overflow-hidden group"
      style={isRunning ? { borderColor: 'rgba(63,185,80,0.3)', boxShadow: '0 0 0 1px rgba(63,185,80,0.1)' } : {}}
    >
      {/* Terminal title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-canvas/40">
        <div className="flex items-center gap-2">
          {/* Traffic light dots */}
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-danger/60" />
            <span className="w-2 h-2 rounded-full bg-warning/60" />
            <span className="w-2 h-2 rounded-full bg-success/60" />
          </div>
          <span className="text-[13px] font-medium" style={{ color: roleColor }}>
            {agent.role}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <span className="relative inline-flex w-1.5 h-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-success" />
            </span>
          )}
          {isError && <span className="w-1.5 h-1.5 rounded-full bg-danger" />}
          {!isRunning && !isError && <span className="w-1.5 h-1.5 rounded-full bg-dim" />}
          <span className="text-[12px] text-muted">{agent.status}</span>
        </div>
      </div>

      {/* Output area (terminal style) */}
      <div className="p-3 font-mono text-[13px] text-muted h-[72px] overflow-hidden scanlines bg-canvas/20">
        {recentLines.length === 0 ? (
          <span className="text-dim">
            Waiting for output<span className="cursor-blink">▋</span>
          </span>
        ) : (
          recentLines.slice(-3).map((line, i) => (
            <div key={i} className="truncate leading-relaxed">{line}</div>
          ))
        )}
      </div>
    </button>
  )
}

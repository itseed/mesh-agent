const STATUS_DOT: Record<string, string> = {
  idle: 'bg-muted',
  running: 'bg-success',
  error: 'bg-danger',
}

const ROLE_COLOR: Record<string, string> = {
  frontend: 'text-cyan-400',
  backend: 'text-blue-400',
  mobile: 'text-purple-400',
  devops: 'text-green-400',
  designer: 'text-pink-400',
  qa: 'text-orange-400',
  reviewer: 'text-red-400',
}

interface AgentCardProps {
  agent: { id: string; role: string; status: string }
  recentLines: string[]
  onClick: () => void
}

export function AgentCard({ agent, recentLines, onClick }: AgentCardProps) {
  return (
    <button
      onClick={onClick}
      className="bg-surface border border-border rounded-xl p-4 text-left hover:border-accent/50 transition-colors w-full"
    >
      <div className="flex items-center justify-between mb-3">
        <span className={`font-semibold text-sm ${ROLE_COLOR[agent.role] ?? 'text-white'}`}>
          {agent.role}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] ?? 'bg-muted'}`} />
          {agent.status}
        </span>
      </div>
      <div className="bg-canvas rounded-lg p-2 font-mono text-xs text-muted h-16 overflow-hidden">
        {recentLines.length === 0 ? (
          <span className="text-border">waiting for output...</span>
        ) : (
          recentLines.slice(-3).map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </button>
  )
}

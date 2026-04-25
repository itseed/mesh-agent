const ROLE_STYLE: Record<string, { bg: string; text: string }> = {
  frontend: { bg: 'rgba(34,211,238,0.1)',  text: '#22d3ee' },
  backend:  { bg: 'rgba(96,165,250,0.1)',  text: '#60a5fa' },
  mobile:   { bg: 'rgba(192,132,252,0.1)', text: '#c084fc' },
  devops:   { bg: 'rgba(74,222,128,0.1)',  text: '#4ade80' },
  designer: { bg: 'rgba(244,114,182,0.1)', text: '#f472b6' },
  qa:       { bg: 'rgba(251,146,60,0.1)',  text: '#fb923c' },
  reviewer: { bg: 'rgba(248,113,113,0.1)', text: '#f87171' },
}

interface TaskCardProps {
  task: { id: string; title: string; agentRole?: string | null; githubPrUrl?: string | null }
  onDelete?: (id: string) => void
  stageColor?: string
}

export function TaskCard({ task, onDelete, stageColor }: TaskCardProps) {
  const role = ROLE_STYLE[task.agentRole ?? '']

  return (
    <div
      className="bg-surface border border-border rounded-lg p-3 text-[14px] group hover:border-border-hi transition-all cursor-grab active:cursor-grabbing"
      style={stageColor ? { borderLeftColor: `${stageColor}40`, borderLeftWidth: 2 } : {}}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-text leading-snug">{task.title}</span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
            className="text-dim hover:text-danger opacity-0 group-hover:opacity-100 transition-all text-[13px] shrink-0"
          >
            ✕
          </button>
        )}
      </div>
      {(task.agentRole || task.githubPrUrl) && (
        <div className="flex items-center gap-1.5 mt-2">
          {task.agentRole && role && (
            <span
              className="text-[12px] px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: role.bg, color: role.text }}
            >
              {task.agentRole}
            </span>
          )}
          {task.githubPrUrl && (
            <a
              href={task.githubPrUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              PR ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}

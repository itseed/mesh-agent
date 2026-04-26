const ROLE_STYLE: Record<string, { bg: string; text: string }> = {
  frontend: { bg: 'rgba(34,211,238,0.1)',  text: '#22d3ee' },
  backend:  { bg: 'rgba(96,165,250,0.1)',  text: '#60a5fa' },
  mobile:   { bg: 'rgba(192,132,252,0.1)', text: '#c084fc' },
  devops:   { bg: 'rgba(74,222,128,0.1)',  text: '#4ade80' },
  designer: { bg: 'rgba(244,114,182,0.1)', text: '#f472b6' },
  qa:       { bg: 'rgba(251,146,60,0.1)',  text: '#fb923c' },
  reviewer: { bg: 'rgba(248,113,113,0.1)', text: '#f87171' },
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: '#f87171',
  high:   '#fb923c',
  medium: '#fbbf24',
  low:    '#374556',
}

interface TaskCardProps {
  task: any
  projects?: any[]
  allTasks?: any[]
  onClick?: () => void
  onDelete?: (id: string) => void
  stageColor?: string
  isDragging?: boolean
}

export function TaskCard({ task, projects, allTasks, onClick, onDelete, stageColor, isDragging }: TaskCardProps) {
  const role = ROLE_STYLE[task.agentRole ?? '']
  const dotColor = PRIORITY_DOT[task.priority ?? ''] ?? null
  const project = projects?.find((p: any) => p.id === task.projectId)
  const subtaskCount = allTasks?.filter((t: any) => t.parentTaskId === task.id).length ?? 0
  const doneCount = allTasks?.filter((t: any) => t.parentTaskId === task.id && t.stage === 'done').length ?? 0

  return (
    <div
      onClick={onClick}
      className="bg-surface border border-border rounded-lg p-3 text-[14px] group hover:border-border-hi transition-all cursor-pointer"
      style={{
        ...(stageColor ? { borderLeftColor: `${stageColor}40`, borderLeftWidth: 2 } : {}),
        opacity: isDragging ? 0.9 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5 flex-1 min-w-0">
          {dotColor && (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
              style={{ backgroundColor: dotColor }}
            />
          )}
          <span className="text-text leading-snug">{task.title}</span>
        </div>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
            className="text-dim hover:text-danger opacity-0 group-hover:opacity-100 transition-all text-[13px] shrink-0"
          >
            ✕
          </button>
        )}
      </div>

      {task.parentTaskId && (
        <div className="text-[11px] text-dim mt-1 ml-3">subtask</div>
      )}

      {(task.agentRole || task.githubPrUrl || project || subtaskCount > 0) && (
        <div className="flex items-center gap-1.5 mt-2 ml-3 flex-wrap">
          {task.agentRole && role && (
            <span
              className="text-[12px] px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: role.bg, color: role.text }}
            >
              {task.agentRole}
            </span>
          )}
          {project && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-muted border border-border">
              {project.name}
            </span>
          )}
          {subtaskCount > 0 && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 border border-border"
              style={{ color: doneCount === subtaskCount ? '#3fb950' : '#6a7a8e' }}
            >
              {doneCount}/{subtaskCount}
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

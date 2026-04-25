const ROLE_COLORS: Record<string, string> = {
  frontend: 'bg-cyan-900 text-cyan-300',
  backend: 'bg-blue-900 text-blue-300',
  mobile: 'bg-purple-900 text-purple-300',
  devops: 'bg-green-900 text-green-300',
  designer: 'bg-pink-900 text-pink-300',
  qa: 'bg-orange-900 text-orange-300',
  reviewer: 'bg-red-900 text-red-300',
}

interface TaskCardProps {
  task: { id: string; title: string; agentRole?: string | null; githubPrUrl?: string | null }
  onDelete?: (id: string) => void
}

export function TaskCard({ task, onDelete }: TaskCardProps) {
  return (
    <div className="bg-canvas border border-border rounded-lg p-3 text-sm group">
      <div className="flex items-start justify-between gap-2">
        <span className="text-white leading-snug">{task.title}</span>
        {onDelete && (
          <button
            onClick={() => onDelete(task.id)}
            className="text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity text-xs"
          >✕</button>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2">
        {task.agentRole && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_COLORS[task.agentRole] ?? 'bg-surface text-muted'}`}>
            {task.agentRole}
          </span>
        )}
        {task.githubPrUrl && (
          <a href={task.githubPrUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            PR ↗
          </a>
        )}
      </div>
    </div>
  )
}

import { ROLE_STYLE } from './task-detail/styles';
import type { Task } from '@meshagent/shared';

function relativeTime(dateStr: Date | string | undefined | null): string | null {
  if (!dateStr) return null;
  const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return date.toLocaleDateString();
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#374556',
};

interface TaskCardProps {
  task: Task;
  projects?: Array<{ id: string; name: string }>;
  allTasks?: Task[];
  onClick?: () => void;
  onDelete?: (id: string) => void;
  onStart?: (id: string) => void;
  stageColor?: string;
  isDragging?: boolean;
}

export function TaskCard({
  task,
  projects,
  allTasks,
  onClick,
  onDelete,
  onStart,
  stageColor,
  isDragging,
}: TaskCardProps) {
  const role = task.agentRole ? ROLE_STYLE[task.agentRole] : undefined;
  const dotColor = PRIORITY_DOT[task.priority ?? ''] ?? null;
  const project = projects?.find((p) => p.id === task.projectId);
  const subtaskCount = allTasks?.filter((t) => t.parentTaskId === task.id).length ?? 0;
  const doneCount =
    allTasks?.filter((t) => t.parentTaskId === task.id && t.stage === 'done').length ?? 0;
  const timeAgo = relativeTime(task.createdAt);

  return (
    <div
      data-task-id={task.id}
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
        <div className="flex items-center gap-1 shrink-0">
          {onStart && task.stage === 'backlog' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStart(task.id);
              }}
              className="text-accent opacity-60 lg:opacity-0 group-hover:opacity-100 transition-all text-[12px] px-1 hover:text-accent/70"
              title="Start with Lead"
            >
              ▶
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
              className="text-dim hover:text-danger opacity-60 lg:opacity-0 group-hover:opacity-100 transition-all text-[13px] shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {task.parentTaskId && <div className="text-[11px] text-dim mt-1 ml-3">Subtask</div>}

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
        {timeAgo && <span className="text-[11px] text-dim ml-auto shrink-0">{timeAgo}</span>}
      </div>
    </div>
  );
}

import { Droppable, Draggable } from '@hello-pangea/dnd'
import { TaskCard } from './TaskCard'

const STAGE_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  backlog:     { label: 'Backlog',     color: '#6a7a8e', bg: 'rgba(106,122,142,0.08)', border: 'rgba(106,122,142,0.2)' },
  in_progress: { label: 'In Progress', color: '#f0883e', bg: 'rgba(240,136,62,0.08)',  border: 'rgba(240,136,62,0.25)' },
  review:      { label: 'Review',      color: '#d2a8ff', bg: 'rgba(210,168,255,0.08)', border: 'rgba(210,168,255,0.25)' },
  done:        { label: 'Done',        color: '#3fb950', bg: 'rgba(63,185,80,0.08)',   border: 'rgba(63,185,80,0.25)' },
}

interface KanbanColumnProps {
  stage: string
  tasks: any[]
  projects: any[]
  allTasks: any[]
  onDelete?: (id: string) => void
  onStart?: (id: string) => void
  onSelect?: (task: any) => void
}

export function KanbanColumn({ stage, tasks, projects, allTasks, onDelete, onStart, onSelect }: KanbanColumnProps) {
  const meta = STAGE_META[stage] ?? { label: stage, color: '#6a7a8e', bg: 'transparent', border: 'transparent' }

  return (
    <div className="flex flex-col min-w-[230px] flex-1">
      <div
        className="flex items-center justify-between mb-3 px-2 py-2 rounded-t border-b"
        style={{ borderColor: meta.border, backgroundColor: meta.bg }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
          <span className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
        <span
          className="text-[12px] font-medium px-1.5 py-0.5 rounded-full"
          style={{ color: meta.color, backgroundColor: `${meta.color}20` }}
        >
          {tasks.length}
        </span>
      </div>

      <Droppable droppableId={stage}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="flex flex-col gap-2 flex-1 min-h-[200px] rounded-b p-1.5 transition-colors"
            style={snapshot.isDraggingOver ? { backgroundColor: `${meta.color}08` } : {}}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    style={provided.draggableProps.style}
                  >
                    <TaskCard
                      task={task}
                      projects={projects}
                      allTasks={allTasks}
                      onDelete={onDelete}
                      onStart={onStart}
                      onClick={() => onSelect?.(task)}
                      stageColor={meta.color}
                      isDragging={snapshot.isDragging}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}

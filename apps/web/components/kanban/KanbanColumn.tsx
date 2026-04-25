import { Droppable, Draggable } from '@hello-pangea/dnd'
import { TaskCard } from './TaskCard'

const STAGE_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

const STAGE_COLORS: Record<string, string> = {
  backlog: 'text-muted',
  in_progress: 'text-warning',
  review: 'text-purple',
  done: 'text-success',
}

interface KanbanColumnProps {
  stage: string
  tasks: any[]
  onDelete?: (id: string) => void
}

export function KanbanColumn({ stage, tasks, onDelete }: KanbanColumnProps) {
  return (
    <div className="flex flex-col min-w-[220px] flex-1">
      <div className={`flex items-center gap-2 mb-3 text-sm font-medium ${STAGE_COLORS[stage]}`}>
        {STAGE_LABELS[stage]}
        <span className="text-muted text-xs font-normal">({tasks.length})</span>
      </div>
      <Droppable droppableId={stage}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex flex-col gap-2 flex-1 min-h-[200px] rounded-lg p-2 transition-colors ${
              snapshot.isDraggingOver ? 'bg-surface/50' : ''
            }`}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                  >
                    <TaskCard task={task} onDelete={onDelete} />
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

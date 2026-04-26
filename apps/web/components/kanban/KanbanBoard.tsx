'use client'
import { useState, useEffect } from 'react'
import { DragDropContext, DropResult } from '@hello-pangea/dnd'
import { KanbanColumn } from './KanbanColumn'
import { TaskDetailPanel } from './TaskDetailPanel'
import { api } from '@/lib/api'

const STAGES = ['backlog', 'in_progress', 'review', 'done'] as const

interface KanbanBoardProps {
  initialTasks: any[]
  onRefresh: () => void
}

export function KanbanBoard({ initialTasks, onRefresh }: KanbanBoardProps) {
  const [tasks, setTasks] = useState(initialTasks)
  const [selectedTask, setSelectedTask] = useState<any | null>(null)

  useEffect(() => {
    setTasks(initialTasks)
    // Keep selectedTask in sync if it's open
    if (selectedTask) {
      const updated = initialTasks.find((t) => t.id === selectedTask.id)
      if (updated) setSelectedTask(updated)
    }
  }, [initialTasks])

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const { draggableId, destination } = result
    const newStage = destination.droppableId

    setTasks((prev) =>
      prev.map((t) => (t.id === draggableId ? { ...t, stage: newStage } : t)),
    )
    await api.tasks.updateStage(draggableId, newStage)
  }

  async function handleDelete(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    if (selectedTask?.id === id) setSelectedTask(null)
    await api.tasks.delete(id)
  }

  // Only show root tasks (no parentTaskId) on the board
  const rootTasks = tasks.filter((t) => !t.parentTaskId)
  const byStage = (stage: string) => rootTasks.filter((t) => t.stage === stage)

  return (
    <>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              tasks={byStage(stage)}
              onDelete={handleDelete}
              onSelect={setSelectedTask}
            />
          ))}
        </div>
      </DragDropContext>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          allTasks={tasks}
          onClose={() => setSelectedTask(null)}
          onUpdate={onRefresh}
        />
      )}
    </>
  )
}

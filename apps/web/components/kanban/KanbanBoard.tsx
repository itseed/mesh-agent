'use client'
import { useState, useEffect } from 'react'
import { DragDropContext, DropResult } from '@hello-pangea/dnd'
import { KanbanColumn } from './KanbanColumn'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const STAGES = ['backlog', 'in_progress', 'review', 'done'] as const

interface KanbanBoardProps {
  initialTasks: any[]
}

export function KanbanBoard({ initialTasks }: KanbanBoardProps) {
  const { token } = useAuth()
  const [tasks, setTasks] = useState(initialTasks)

  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  async function onDragEnd(result: DropResult) {
    if (!result.destination || !token) return
    const { draggableId, destination } = result
    const newStage = destination.droppableId

    setTasks((prev) =>
      prev.map((t) => (t.id === draggableId ? { ...t, stage: newStage } : t)),
    )
    await api.tasks.updateStage(token, draggableId, newStage)
  }

  async function handleDelete(id: string) {
    if (!token) return
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await api.tasks.delete(token, id)
  }

  const byStage = (stage: string) => tasks.filter((t) => t.stage === stage)

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            tasks={byStage(stage)}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </DragDropContext>
  )
}

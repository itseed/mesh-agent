import { TopNav } from '@/components/layout/TopNav'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'

export default function KanbanPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="p-6">
        <h1 className="text-lg font-semibold mb-6">Kanban</h1>
        <KanbanBoard initialTasks={[]} />
      </main>
    </div>
  )
}

import { TopNav } from '@/components/layout/TopNav'
import { AgentGrid } from '@/components/agents/AgentGrid'

export default function AgentsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="p-6 pb-24">
        <h1 className="text-lg font-semibold mb-6">Agents</h1>
        <AgentGrid agents={[]} />
      </main>
    </div>
  )
}

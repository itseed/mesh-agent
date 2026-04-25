import { TopNav } from '@/components/layout/TopNav'

export default function OverviewPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="p-6 pb-24">
        <h1 className="text-lg font-semibold mb-6">Overview</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium mb-3 text-muted">Agents</h2>
            <p className="text-2xl font-bold text-success">0</p>
            <p className="text-xs text-muted mt-1">running</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium mb-3 text-muted">Tasks</h2>
            <div className="flex gap-4 text-sm">
              <div><span className="font-bold">0</span> <span className="text-muted text-xs">backlog</span></div>
              <div><span className="font-bold text-warning">0</span> <span className="text-muted text-xs">in progress</span></div>
              <div><span className="font-bold text-success">0</span> <span className="text-muted text-xs">done</span></div>
            </div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium mb-3 text-muted">GitHub</h2>
            <p className="text-xs text-muted">Connect a project to see activity</p>
          </div>
        </div>
        <div className="mt-6 bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium mb-3 text-muted">Recent Activity</h2>
          <p className="text-xs text-muted">No recent activity</p>
        </div>
      </main>
    </div>
  )
}

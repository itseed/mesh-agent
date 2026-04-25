import { TopNav } from '@/components/layout/TopNav'

export default function GitHubPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="p-6 pb-24">
        <h1 className="text-lg font-semibold mb-6">GitHub</h1>
        <div className="flex gap-4 mb-6 text-sm border-b border-border pb-3">
          <button className="text-white border-b-2 border-accent pb-2">Pull Requests</button>
          <button className="text-muted hover:text-white">Commits</button>
          <button className="text-muted hover:text-white">Issues</button>
        </div>
        <p className="text-muted text-sm">Select a project with a linked GitHub repo to view PRs.</p>
      </main>
    </div>
  )
}

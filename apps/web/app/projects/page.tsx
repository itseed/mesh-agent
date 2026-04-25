import { TopNav } from '@/components/layout/TopNav'

export default function ProjectsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="p-6 pb-24">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold">Projects</h1>
          <button className="bg-accent text-canvas text-xs font-semibold px-3 py-1.5 rounded-lg">
            + New Project
          </button>
        </div>
        <p className="text-muted text-sm">No projects yet. Create one to get started.</p>
      </main>
    </div>
  )
}

'use client'
import { useState, useEffect, useCallback } from 'react'
import { TopNav } from '@/components/layout/TopNav'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Tab = 'prs' | 'commits'

export default function GitHubPage() {
  const { token } = useAuth()
  const [tab, setTab] = useState<Tab>('prs')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeProject, setActiveProject] = useState<any>(null)
  const [prs, setPrs] = useState<any[]>([])
  const [commits, setCommits] = useState<any[]>([])

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const projects = await api.projects.list(token)
      const active = projects.find((p: any) => p.isActive) ?? null
      setActiveProject(active)
      if (active?.githubRepos?.length) {
        const repo = active.githubRepos[0]
        const [prsData, commitsData] = await Promise.all([
          api.github.prs(token, repo),
          api.github.commits(token, repo),
        ])
        setPrs(prsData)
        setCommits(commitsData)
      }
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  const noRepo = !activeProject || !activeProject.githubRepos?.length

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas">
        <TopNav />
        <main className="p-6 pb-24">
          <h1 className="text-lg font-semibold mb-6">GitHub</h1>
          {error && <p className="text-danger text-sm mb-4">{error}</p>}
          {loading ? (
            <p className="text-muted text-sm">Loading...</p>
          ) : noRepo ? (
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-muted text-sm">
                {!activeProject
                  ? 'No active project. Go to Projects to set one.'
                  : 'Active project has no linked GitHub repos. Edit the project to add githubRepos.'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-4 mb-6 text-sm border-b border-border pb-3">
                <button
                  onClick={() => setTab('prs')}
                  className={`pb-2 ${tab === 'prs' ? 'text-white border-b-2 border-accent' : 'text-muted hover:text-white'}`}
                >
                  Pull Requests ({prs.length})
                </button>
                <button
                  onClick={() => setTab('commits')}
                  className={`pb-2 ${tab === 'commits' ? 'text-white border-b-2 border-accent' : 'text-muted hover:text-white'}`}
                >
                  Commits ({commits.length})
                </button>
              </div>
              {tab === 'prs' && (
                <div className="flex flex-col gap-2">
                  {prs.length === 0 ? (
                    <p className="text-muted text-sm">No open pull requests.</p>
                  ) : prs.map((pr: any) => (
                    <div key={pr.id ?? pr.number} className="bg-surface border border-border rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <a href={pr.url ?? pr.html_url} target="_blank" rel="noreferrer"
                            className="text-sm text-accent hover:underline font-medium">
                            #{pr.number} {pr.title}
                          </a>
                          <p className="text-xs text-muted mt-1">{pr.user?.login ?? pr.author} · {pr.state}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                          pr.state === 'open' ? 'bg-success/20 text-success' : 'bg-muted/20 text-muted'
                        }`}>{pr.state}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'commits' && (
                <div className="flex flex-col gap-2">
                  {commits.length === 0 ? (
                    <p className="text-muted text-sm">No commits found.</p>
                  ) : commits.map((c: any, i: number) => (
                    <div key={c.sha ?? i} className="bg-surface border border-border rounded-xl p-3">
                      <p className="text-sm font-mono text-white truncate">{c.commit?.message ?? c.message}</p>
                      <p className="text-xs text-muted mt-1 font-mono">
                        {(c.sha ?? c.id ?? '').slice(0, 7)} · {c.commit?.author?.name ?? c.author}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}

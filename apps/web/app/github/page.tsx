'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/layout/AppShell'
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
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          <div className="mb-6">
            <h1 className="text-[15px] font-semibold text-text tracking-tight">GitHub</h1>
            {activeProject && (
              <p className="text-[13px] text-muted mt-0.5">{activeProject.name}</p>
            )}
          </div>

          {error && <p className="text-danger text-[14px] mb-4">✕ {error}</p>}

          {loading ? (
            <p className="text-muted text-[14px]"><span className="cursor-blink">▋</span> Loading…</p>
          ) : noRepo ? (
            <div className="bg-surface border border-border rounded-lg p-8 text-center">
              <div className="text-muted text-[24px] mb-3 opacity-30">⌥</div>
              <p className="text-[14px] text-muted">
                {!activeProject
                  ? 'No active project. Go to Projects to set one.'
                  : 'No GitHub repo linked. Edit your project to add githubRepos.'}
              </p>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-0 mb-5 bg-surface border border-border rounded-lg p-0.5 w-fit">
                {(['prs', 'commits'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-1.5 rounded text-[14px] font-medium transition-all ${
                      tab === t
                        ? 'bg-canvas text-text shadow-sm'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {t === 'prs' ? `PRs (${prs.length})` : `Commits (${commits.length})`}
                  </button>
                ))}
              </div>

              {tab === 'prs' && (
                <div className="flex flex-col gap-2">
                  {prs.length === 0 ? (
                    <p className="text-muted text-[14px]">No open pull requests.</p>
                  ) : prs.map((pr: any) => (
                    <div key={pr.id ?? pr.number} className="bg-surface border border-border rounded-lg p-4 hover:border-border-hi transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <a
                            href={pr.url ?? pr.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[15px] text-accent hover:underline"
                          >
                            #{pr.number} {pr.title}
                          </a>
                          <p className="text-[13px] text-muted mt-1">
                            {pr.user?.login ?? pr.author} · {pr.state}
                          </p>
                        </div>
                        <span className={`text-[12px] px-2 py-0.5 rounded-full shrink-0 font-medium ${
                          pr.state === 'open'
                            ? 'bg-success/15 text-success border border-success/20'
                            : 'bg-muted/10 text-muted border border-border'
                        }`}>
                          {pr.state}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'commits' && (
                <div className="flex flex-col gap-2">
                  {commits.length === 0 ? (
                    <p className="text-muted text-[14px]">No commits found.</p>
                  ) : commits.map((c: any, i: number) => (
                    <div key={c.sha ?? i} className="bg-surface border border-border rounded-lg p-3 hover:border-border-hi transition-colors">
                      <p className="text-[14px] text-text truncate leading-snug">
                        {c.commit?.message ?? c.message}
                      </p>
                      <p className="text-[12px] text-muted mt-1.5">
                        <span className="text-dim font-mono">{(c.sha ?? c.id ?? '').slice(0, 7)}</span>
                        {' · '}
                        {c.commit?.author?.name ?? c.author}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  )
}

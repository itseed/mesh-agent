'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface GhStatus {
  connected: boolean
  tokenPreview: string | null
  oauthEnabled: boolean
  user: { login: string; avatarUrl?: string } | null
}

interface Repo {
  id: number
  fullName: string
  name: string
  owner: string
  private: boolean
  description: string | null
  defaultBranch: string
  updatedAt: string | null
  htmlUrl: string
}

interface Project {
  id: string
  name: string
  isActive: boolean
  githubRepos: string[]
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  )
}

function SettingsPageInner() {
  const { token } = useAuth()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<GhStatus | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const [s, p] = await Promise.all([api.settings.get(token), api.projects.list(token)])
      setStatus(s.github)
      setProjects(p as Project[])
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [token])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (searchParams.get('connected') === '1') {
      setInfo('เชื่อมต่อ GitHub สำเร็จแล้ว')
    }
  }, [searchParams])

  async function loadRepos() {
    if (!token) return
    setLoadingRepos(true)
    setError('')
    try {
      const list = await api.settings.listRepos(token)
      setRepos(list)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingRepos(false)
    }
  }

  async function saveToken() {
    if (!token || !tokenInput.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.settings.saveToken(token, tokenInput.trim())
      setTokenInput('')
      setInfo('บันทึก token สำเร็จ')
      await refresh()
      await loadRepos()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!token) return
    if (!confirm('ตัดการเชื่อมต่อ GitHub?')) return
    try {
      await api.settings.disconnect(token)
      setRepos([])
      setSelected(new Set())
      setInfo('ตัดการเชื่อมต่อแล้ว')
      await refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function startOAuth() {
    if (!token) return
    setError('')
    try {
      const { url } = await api.settings.oauthStart(token)
      window.location.href = url
    } catch (e: any) {
      setError(e.message)
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function syncSelected() {
    if (!token || selected.size === 0) return
    const activeProject = projects.find((p) => p.isActive)
    if (!activeProject) {
      setError('กรุณาตั้ง active project ก่อนใน Projects')
      return
    }
    setSyncing(true)
    setError('')
    try {
      await api.settings.syncRepos(token, Array.from(selected), activeProject.id)
      setInfo(`ผูก ${selected.size} repo ไว้กับ ${activeProject.name} แล้ว`)
      setSelected(new Set())
      await refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const inputCls =
    'bg-canvas border border-border text-text text-[14px] rounded px-3 py-2 placeholder-dim w-full'

  const filteredRepos = repos.filter(
    (r) =>
      !search.trim() ||
      r.fullName.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const activeProject = projects.find((p) => p.isActive)
  const linkedSet = new Set(activeProject?.githubRepos ?? [])

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-32 fade-up max-w-3xl">
          <div className="mb-6">
            <h1 className="text-[15px] font-semibold text-text tracking-tight">ตั้งค่า</h1>
            <p className="text-[13px] text-muted mt-0.5">
              เชื่อมต่อ GitHub แล้ว sync repo ลงมาทำงาน
            </p>
          </div>

          {error && (
            <p className="text-danger text-[13px] mb-3 bg-danger/5 border border-danger/20 rounded px-3 py-2">
              ✕ {error}
            </p>
          )}
          {info && (
            <p className="text-success text-[13px] mb-3 bg-success/5 border border-success/20 rounded px-3 py-2">
              ✓ {info}
            </p>
          )}

          {/* GitHub connection */}
          <section className="bg-surface border border-border rounded-lg p-5 mb-5">
            <div className="flex items-start justify-between mb-4 gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-text">GitHub</h2>
                <p className="text-[13px] text-muted mt-0.5">
                  ใช้ token หรือ OAuth เพื่อเข้าถึง repo
                </p>
              </div>
              {status?.connected && status.user && (
                <div className="flex items-center gap-2 bg-success/10 border border-success/25 px-3 py-1.5 rounded-full">
                  {status.user.avatarUrl && (
                    <img
                      src={status.user.avatarUrl}
                      alt=""
                      className="w-5 h-5 rounded-full"
                    />
                  )}
                  <span className="text-[13px] text-success font-medium">
                    {status.user.login}
                  </span>
                </div>
              )}
            </div>

            {status?.connected ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted">
                  Token: <span className="font-mono text-dim">{status.tokenPreview ?? '—'}</span>
                </span>
                <button
                  onClick={loadRepos}
                  disabled={loadingRepos}
                  className="bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-[13px] font-semibold px-3 py-1.5 rounded transition-all disabled:opacity-50"
                >
                  {loadingRepos ? 'กำลังโหลด…' : 'โหลดรายการ repo'}
                </button>
                <button
                  onClick={disconnect}
                  className="text-muted hover:text-danger text-[13px] px-3 py-1.5 rounded border border-border hover:border-danger/40 transition-all"
                >
                  ตัดการเชื่อมต่อ
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wider mb-1.5">
                    Personal Access Token
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="ghp_..."
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      className={inputCls}
                    />
                    <button
                      onClick={saveToken}
                      disabled={saving || !tokenInput.trim()}
                      className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold px-4 py-2 rounded transition-colors disabled:opacity-40 shrink-0"
                    >
                      {saving ? '…' : 'บันทึก'}
                    </button>
                  </div>
                  <p className="text-[12px] text-dim mt-1">
                    สร้างได้ที่{' '}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo,read:user,read:org&description=MeshAgent"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      github.com/settings/tokens
                    </a>{' '}
                    (ต้องการ scope: repo, read:user, read:org)
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[12px] text-dim">หรือ</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <button
                  onClick={startOAuth}
                  disabled={!status?.oauthEnabled}
                  title={
                    !status?.oauthEnabled
                      ? 'ต้องตั้ง GITHUB_OAUTH_CLIENT_ID และ GITHUB_OAUTH_CLIENT_SECRET ใน .env'
                      : undefined
                  }
                  className="flex items-center justify-center gap-2 bg-canvas hover:bg-surface-2 border border-border-hi text-text text-[14px] font-semibold py-2 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.16-.89-1.16-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.21 2.2.82A7.66 7.66 0 0 1 8 3.74c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.51.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                  </svg>
                  {status?.oauthEnabled ? 'Authenticate ผ่าน GitHub' : 'OAuth ยังไม่ได้ตั้งค่า'}
                </button>
              </div>
            )}
          </section>

          {/* Repo sync */}
          {status?.connected && (
            <section className="bg-surface border border-border rounded-lg p-5">
              <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
                <div>
                  <h2 className="text-[14px] font-semibold text-text">Sync repository</h2>
                  <p className="text-[13px] text-muted mt-0.5">
                    {activeProject
                      ? `จะผูกกับโปรเจกต์: ${activeProject.name}`
                      : 'ยังไม่มี active project — ไปตั้งที่ Projects ก่อน'}
                  </p>
                </div>
                {selected.size > 0 && activeProject && (
                  <button
                    onClick={syncSelected}
                    disabled={syncing}
                    className="bg-success/15 hover:bg-success/25 border border-success/30 text-success text-[13px] font-semibold px-4 py-1.5 rounded transition-all disabled:opacity-50"
                  >
                    {syncing ? 'กำลัง sync…' : `Sync ${selected.size} repo`}
                  </button>
                )}
              </div>

              {repos.length === 0 ? (
                <p className="text-muted text-[14px] text-center py-6">
                  กดปุ่ม "โหลดรายการ repo" ด้านบน
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="ค้นหา repo…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={`${inputCls} mb-3`}
                  />
                  <div className="flex flex-col gap-1.5 max-h-[460px] overflow-y-auto">
                    {filteredRepos.map((r) => {
                      const isSelected = selected.has(r.fullName)
                      const isLinked = linkedSet.has(r.fullName)
                      return (
                        <label
                          key={r.id}
                          className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                            isSelected
                              ? 'border-accent/40 bg-accent/[0.05]'
                              : 'border-border hover:border-border-hi'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(r.fullName)}
                            disabled={isLinked}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[14px] font-medium text-text truncate">
                                {r.fullName}
                              </span>
                              {r.private && (
                                <span className="text-[11px] bg-warning/15 text-warning border border-warning/25 px-1.5 py-0.5 rounded-full font-medium">
                                  private
                                </span>
                              )}
                              {isLinked && (
                                <span className="text-[11px] bg-success/15 text-success border border-success/25 px-1.5 py-0.5 rounded-full font-medium">
                                  linked
                                </span>
                              )}
                            </div>
                            {r.description && (
                              <p className="text-[12px] text-muted mt-0.5 truncate">
                                {r.description}
                              </p>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  )
}

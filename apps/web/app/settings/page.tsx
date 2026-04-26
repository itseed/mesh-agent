'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { api } from '@/lib/api'

interface GhStatus {
  connected: boolean
  tokenPreview: string | null
  oauthEnabled: boolean
  user: { login: string; avatarUrl?: string } | null
}

const emptyForm = { slug: '', name: '', description: '', systemPrompt: '', keywords: '' }

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  )
}

function SettingsPageInner() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<GhStatus | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [roles, setRoles] = useState<any[]>([])
  const [showRoleForm, setShowRoleForm] = useState(false)
  const [editingRole, setEditingRole] = useState<any | null>(null)
  const [roleForm, setRoleForm] = useState(emptyForm)
  const [roleError, setRoleError] = useState('')
  const [submittingRole, setSubmittingRole] = useState(false)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, , r] = await Promise.all([
        api.settings.get(),
        api.projects.list(),
        api.agents.listRoles(),
      ])
      setStatus(s.github)
      setRoles(r)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (searchParams.get('connected') === '1') setInfo('เชื่อมต่อ GitHub สำเร็จแล้ว')
  }, [searchParams])

  async function saveToken() {
    if (!tokenInput.trim()) return
    setSaving(true)
    setError('')
    try {
      await api.settings.saveToken(tokenInput.trim())
      setTokenInput('')
      setInfo('บันทึก token สำเร็จ')
      await refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!confirm('ตัดการเชื่อมต่อ GitHub?')) return
    try {
      await api.settings.disconnect()
      setInfo('ตัดการเชื่อมต่อแล้ว')
      await refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function startOAuth() {
    setError('')
    try {
      const { url } = await api.settings.oauthStart()
      window.location.href = url
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function submitRole(e: React.FormEvent) {
    e.preventDefault()
    setSubmittingRole(true)
    setRoleError('')
    try {
      const data = {
        slug: roleForm.slug,
        name: roleForm.name,
        description: roleForm.description || undefined,
        systemPrompt: roleForm.systemPrompt || undefined,
        keywords: roleForm.keywords.split(',').map((k) => k.trim()).filter(Boolean),
      }
      if (editingRole) {
        await api.agents.updateRole(editingRole.slug, data)
      } else {
        await api.agents.createRole(data)
      }
      setShowRoleForm(false)
      setEditingRole(null)
      setRoleForm(emptyForm)
      await refresh()
    } catch (e: any) {
      setRoleError(e.message)
    } finally {
      setSubmittingRole(false)
    }
  }

  async function deleteRole(slug: string) {
    try {
      await api.agents.deleteRole(slug)
      setDeletingSlug(null)
      await refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const inputCls = 'bg-canvas border border-border text-text text-[14px] rounded px-3 py-2 placeholder-dim w-full'

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-32 fade-up max-w-3xl">
          <div className="mb-6">
            <h1 className="text-[15px] font-semibold text-text tracking-tight">ตั้งค่า</h1>
            <p className="text-[13px] text-muted mt-0.5">GitHub connection และ Agent Skills</p>
          </div>

          {error && (
            <p className="text-danger text-[13px] mb-3 bg-danger/5 border border-danger/20 rounded px-3 py-2">✕ {error}</p>
          )}
          {info && (
            <p className="text-success text-[13px] mb-3 bg-success/5 border border-success/20 rounded px-3 py-2">✓ {info}</p>
          )}

          {/* GitHub connection */}
          <section className="bg-surface border border-border rounded-lg p-5 mb-5">
            <div className="flex items-start justify-between mb-4 gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-text">GitHub</h2>
                <p className="text-[13px] text-muted mt-0.5">ใช้ token หรือ OAuth เพื่อเข้าถึง repo</p>
              </div>
              {status?.connected && status.user && (
                <div className="flex items-center gap-2 bg-success/10 border border-success/25 px-3 py-1.5 rounded-full">
                  {status.user.avatarUrl && (
                    <img src={status.user.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                  )}
                  <span className="text-[13px] text-success font-medium">{status.user.login}</span>
                </div>
              )}
            </div>

            {status?.connected ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted">
                  Token: <span className="font-mono text-dim">{status.tokenPreview ?? '—'}</span>
                </span>
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
                  title={!status?.oauthEnabled ? 'ต้องตั้ง GITHUB_OAUTH_CLIENT_ID และ GITHUB_OAUTH_CLIENT_SECRET ใน .env' : undefined}
                  className="flex items-center justify-center gap-2 bg-canvas hover:bg-surface-2 border border-border-hi text-text text-[14px] font-semibold py-2 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.16-.89-1.16-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.21 2.2.82A7.66 7.66 0 0 1 8 3.74c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.51.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  {status?.oauthEnabled ? 'Authenticate ผ่าน GitHub' : 'OAuth ยังไม่ได้ตั้งค่า'}
                </button>
              </div>
            )}
          </section>

          {/* Agent Skills */}
          <section className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-semibold text-text">Agent Skills</h2>
                <p className="text-[13px] text-muted mt-0.5">กำหนด role และ system prompt สำหรับแต่ละ agent</p>
              </div>
              <button
                onClick={() => { setEditingRole(null); setRoleForm(emptyForm); setRoleError(''); setShowRoleForm(true) }}
                className="text-[13px] bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent px-3 py-1.5 rounded transition-all"
              >
                + New Skill
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {roles.length === 0 && (
                <p className="text-muted text-[13px] text-center py-4">ยังไม่มี skill — กด + New Skill เพื่อเพิ่ม</p>
              )}
              {roles.map((role) => (
                <div key={role.slug} className="flex items-start gap-3 p-3 border border-border rounded-lg hover:border-border-hi transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-mono bg-surface-2 border border-border px-1.5 py-0.5 rounded text-accent">{role.slug}</span>
                      <span className="text-[14px] font-medium text-text">{role.name}</span>
                      {role.isBuiltin && (
                        <span className="text-[11px] text-dim bg-surface-2 border border-border px-1.5 py-0.5 rounded">builtin</span>
                      )}
                    </div>
                    {role.description && (
                      <p className="text-[12px] text-muted mt-1 truncate">{role.description}</p>
                    )}
                    {role.keywords?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {role.keywords.map((k: string) => (
                          <span key={k} className="text-[11px] bg-surface-2 text-dim px-1.5 py-0.5 rounded border border-border">{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingRole(role)
                        setRoleForm({
                          slug: role.slug,
                          name: role.name,
                          description: role.description ?? '',
                          systemPrompt: role.systemPrompt ?? '',
                          keywords: (role.keywords ?? []).join(', '),
                        })
                        setRoleError('')
                        setShowRoleForm(true)
                      }}
                      className="text-[12px] text-muted hover:text-text transition-colors px-2 py-1"
                    >
                      Edit
                    </button>
                    {!role.isBuiltin && (
                      deletingSlug === role.slug ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] text-danger">ลบ?</span>
                          <button
                            onClick={() => deleteRole(role.slug)}
                            className="text-[12px] text-danger border border-danger/30 px-2 py-0.5 rounded hover:bg-danger/10 transition-colors"
                          >
                            ยืนยัน
                          </button>
                          <button
                            onClick={() => setDeletingSlug(null)}
                            className="text-[12px] text-muted hover:text-text transition-colors"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingSlug(role.slug)}
                          className="text-[12px] text-muted hover:text-danger transition-colors px-2 py-1"
                        >
                          ลบ
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Role form modal */}
        {showRoleForm && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-border-hi rounded-xl w-full max-w-lg p-5 glow-border fade-up max-h-[90vh] overflow-y-auto">
              <h2 className="text-[14px] font-semibold text-text mb-4">{editingRole ? 'Edit Skill' : 'New Skill'}</h2>
              {roleError && (
                <p className="text-danger text-[13px] mb-3 bg-danger/5 border border-danger/20 rounded px-3 py-2">✕ {roleError}</p>
              )}
              <form onSubmit={submitRole} className="flex flex-col gap-3">
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">Slug *</label>
                  <input
                    type="text"
                    value={roleForm.slug}
                    onChange={(e) => setRoleForm((p) => ({ ...p, slug: e.target.value }))}
                    readOnly={!!editingRole}
                    pattern="^[a-z0-9_-]+$"
                    required
                    className={`${inputCls} ${editingRole ? 'opacity-60 cursor-not-allowed' : ''}`}
                    placeholder="e.g. frontend"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">Name *</label>
                  <input
                    type="text"
                    value={roleForm.name}
                    onChange={(e) => setRoleForm((p) => ({ ...p, name: e.target.value }))}
                    required
                    className={inputCls}
                    placeholder="e.g. Frontend Developer"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">Description</label>
                  <input
                    type="text"
                    value={roleForm.description}
                    onChange={(e) => setRoleForm((p) => ({ ...p, description: e.target.value }))}
                    className={inputCls}
                    placeholder="Short description"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">System Prompt</label>
                  <textarea
                    value={roleForm.systemPrompt}
                    onChange={(e) => setRoleForm((p) => ({ ...p, systemPrompt: e.target.value }))}
                    rows={6}
                    className={`${inputCls} resize-none`}
                    placeholder="Instructions for this agent role…"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">Keywords</label>
                  <input
                    type="text"
                    value={roleForm.keywords}
                    onChange={(e) => setRoleForm((p) => ({ ...p, keywords: e.target.value }))}
                    className={inputCls}
                    placeholder="react, typescript, nextjs"
                  />
                </div>
                <div className="flex gap-2 justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => setShowRoleForm(false)}
                    className="text-muted text-[14px] px-3 py-1.5 hover:text-text transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingRole}
                    className="bg-accent/90 hover:bg-accent text-canvas text-[14px] font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    {submittingRole ? '…' : editingRole ? 'Save' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  )
}

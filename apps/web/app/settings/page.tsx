'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/layout/AuthGuard';
import { api } from '@/lib/api';
import { PageLoader } from '@/components/ui/PageLoader';

interface GhStatus {
  connected: boolean;
  tokenPreview: string | null;
  oauthEnabled: boolean;
  user: { login: string; avatarUrl?: string } | null;
}

const emptyForm = { slug: '', name: '', description: '', systemPrompt: '', keywords: '' };

const PROVIDER_LOGIN_INSTRUCTIONS: Record<string, string> = {
  claude: 'docker exec -it <orchestrator-container> sh\nclaude auth login',
  gemini: 'docker exec -it <orchestrator-container> sh\ngemini auth login',
  cursor: 'docker exec -it <orchestrator-container> sh\nagent login',
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'skills' | 'github' | 'providers' | 'companion'>(
    'providers',
  );

  const [status, setStatus] = useState<GhStatus | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [roles, setRoles] = useState<any[]>([]);
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRole, setEditingRole] = useState<any | null>(null);
  const [roleForm, setRoleForm] = useState(emptyForm);
  const [roleError, setRoleError] = useState('');
  const [submittingRole, setSubmittingRole] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  // CLI Providers tab state
  const [providers, setProviders] = useState<
    Array<{
      id: string;
      name: string;
      loggedIn: boolean;
      enabled: boolean;
      isDefault: boolean;
      loginInstructions: string;
    }>
  >([]);
  const [expandedInstructions, setExpandedInstructions] = useState<string | null>(null);
  const [oauthToken, setOauthToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenInfo, setTokenInfo] = useState('');
  const [tokenError, setTokenError] = useState('');

  // Companion tab state
  const [companionStatus, setCompanionStatus] = useState<{
    connected: boolean;
    connectedAt: string | null;
  } | null>(null);
  const [companionTokens, setCompanionTokens] = useState<
    { id: string; label: string; prefix: string; lastSeenAt: string | null }[]
  >([]);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Claude CLI tab state
  const [cliTesting, setCliTesting] = useState(false);
  const [cliTestResult, setCliTestResult] = useState<{
    ok: boolean;
    version?: string;
    error?: string;
    cmd: string;
  } | null>(null);
  const [reposBaseDir, setReposBaseDir] = useState('');
  const [savedBaseDir, setSavedBaseDir] = useState<string | null>(null);
  const [savingBaseDir, setSavingBaseDir] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, , r] = await Promise.all([
        api.settings.get(),
        api.projects.list(),
        api.agents.listRoles(),
      ]);
      setStatus(s.github);
      setSavedBaseDir(s.reposBaseDir ?? null);
      setReposBaseDir(s.reposBaseDir ?? '');
      setRoles(r);
      setError('');

      // Load CLI providers from API
      try {
        const cliRows = await api.settings.listCliProviders();
        const healthResults = await Promise.allSettled(
          cliRows.map((row) => api.settings.testCliProvider(row.provider)),
        );
        setProviders(
          cliRows.map((row, i) => {
            const health = healthResults[i].status === 'fulfilled' ? healthResults[i].value : null;
            return {
              id: row.provider,
              name: row.provider.charAt(0).toUpperCase() + row.provider.slice(1),
              loggedIn: health?.loggedIn ?? false,
              enabled: row.enabled,
              isDefault: row.isDefault,
              loginInstructions: PROVIDER_LOGIN_INSTRUCTIONS[row.provider] ?? '',
            };
          }),
        );
      } catch {
        // keep whatever state providers is in
      }

      // Load companion status + tokens
      const [compStatus, compTokens] = await Promise.all([
        api.companion.status().catch(() => null),
        api.companion.listTokens().catch(() => []),
      ]);
      setCompanionStatus(compStatus);
      setCompanionTokens(compTokens);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    api.companion
      .status()
      .then((s) => setCompanionStatus(s))
      .catch(() => {});
    const interval = setInterval(() => {
      api.companion
        .status()
        .then((s) => setCompanionStatus(s))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (searchParams.get('connected') === '1') setInfo('เชื่อมต่อ GitHub สำเร็จแล้ว');
  }, [searchParams]);

  async function saveToken() {
    if (!tokenInput.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.settings.saveToken(tokenInput.trim());
      setTokenInput('');
      setInfo('บันทึก token สำเร็จ');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm('ตัดการเชื่อมต่อ GitHub?')) return;
    try {
      await api.settings.disconnect();
      setInfo('ตัดการเชื่อมต่อแล้ว');
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function startOAuth() {
    setError('');
    try {
      const { url } = await api.settings.oauthStart();
      window.location.href = url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveBaseDir() {
    setSavingBaseDir(true);
    try {
      if (reposBaseDir.trim()) {
        await api.settings.saveReposBaseDir(reposBaseDir.trim());
        setSavedBaseDir(reposBaseDir.trim());
      } else {
        await api.settings.resetReposBaseDir();
        setSavedBaseDir(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingBaseDir(false);
    }
  }

  async function testCli() {
    setCliTesting(true);
    setCliTestResult(null);
    try {
      const r = await api.settings.testCli();
      setCliTestResult(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCliTesting(false);
    }
  }

  async function submitRole(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingRole(true);
    setRoleError('');
    try {
      const data = {
        slug: roleForm.slug,
        name: roleForm.name,
        description: roleForm.description || undefined,
        systemPrompt: roleForm.systemPrompt || undefined,
        keywords: roleForm.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      };
      if (editingRole) {
        await api.agents.updateRole(editingRole.slug, data);
      } else {
        await api.agents.createRole(data);
      }
      setShowRoleForm(false);
      setEditingRole(null);
      setRoleForm(emptyForm);
      await refresh();
    } catch (e: any) {
      setRoleError(e.message);
    } finally {
      setSubmittingRole(false);
    }
  }

  async function deleteRole(slug: string) {
    try {
      await api.agents.deleteRole(slug);
      setDeletingSlug(null);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const inputCls =
    'bg-canvas border border-border text-text text-[14px] rounded px-3 py-2 placeholder-dim w-full';

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-32 fade-up max-w-4xl">
          <div className="mb-4">
            <h1 className="text-[15px] font-semibold text-text tracking-tight">ตั้งค่า</h1>
            <p className="text-[13px] text-muted mt-0.5">CLI · Agent Skills · GitHub</p>
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

          {/* Tab bar */}
          <div className="flex gap-0 mb-6 border-b border-border">
            {(
              [
                ['providers', 'CLI'],
                ['skills', 'Agent Skills'],
                ['github', 'GitHub'],
                ['companion', 'Companion'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-4 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === id
                    ? 'text-text border-accent'
                    : 'text-muted border-transparent hover:text-text hover:border-border-hi'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* GitHub connection */}
          {activeTab === 'github' && (
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
                      <Image src={status.user.avatarUrl} alt="" width={20} height={20} className="w-5 h-5 rounded-full" unoptimized />
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
                      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.16-.89-1.16-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.21 2.2.82A7.66 7.66 0 0 1 8 3.74c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.51.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    {status?.oauthEnabled ? 'Authenticate ผ่าน GitHub' : 'OAuth ยังไม่ได้ตั้งค่า'}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Agent Skills */}
          {activeTab === 'skills' && (
            <section className="bg-surface border border-border rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-[14px] font-semibold text-text">Agent Skills</h2>
                  <p className="text-[13px] text-muted mt-0.5">
                    กำหนด role และ system prompt สำหรับแต่ละ agent
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingRole(null);
                    setRoleForm(emptyForm);
                    setRoleError('');
                    setShowRoleForm(true);
                  }}
                  className="text-[13px] bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent px-3 py-1.5 rounded transition-all"
                >
                  + New Skill
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {roles.length === 0 && (
                  <p className="text-muted text-[13px] text-center py-4">
                    ยังไม่มี skill — กด + New Skill เพื่อเพิ่ม
                  </p>
                )}
                {roles.map((role) => (
                  <div
                    key={role.slug}
                    className="flex items-start gap-3 p-3 border border-border rounded-lg hover:border-border-hi transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-mono bg-surface-2 border border-border px-1.5 py-0.5 rounded text-accent">
                          {role.slug}
                        </span>
                        <span className="text-[14px] font-medium text-text">{role.name}</span>
                        {role.isBuiltin && (
                          <span className="text-[11px] text-dim bg-surface-2 border border-border px-1.5 py-0.5 rounded">
                            builtin
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-[12px] text-muted mt-1 truncate">{role.description}</p>
                      )}
                      {role.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {role.keywords.map((k: string) => (
                            <span
                              key={k}
                              className="text-[11px] bg-surface-2 text-dim px-1.5 py-0.5 rounded border border-border"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditingRole(role);
                          setRoleForm({
                            slug: role.slug,
                            name: role.name,
                            description: role.description ?? '',
                            systemPrompt: role.systemPrompt ?? '',
                            keywords: (role.keywords ?? []).join(', '),
                          });
                          setRoleError('');
                          setShowRoleForm(true);
                        }}
                        className="text-[12px] text-muted hover:text-text transition-colors px-2 py-1"
                      >
                        Edit
                      </button>
                      {!role.isBuiltin &&
                        (deletingSlug === role.slug ? (
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
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Companion tab */}
          {activeTab === 'companion' && (
            <div className="space-y-4">
              {/* Connection status */}
              <div className="bg-surface border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[14px] font-semibold text-text">Local Companion</div>
                    <div className="text-[12px] text-muted mt-0.5">
                      Connect your local machine to run agents locally
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${companionStatus?.connected ? 'bg-success shadow-[0_0_6px_#3fb950]' : 'bg-dim'}`}
                    />
                    <span
                      className={`text-[12px] ${companionStatus?.connected ? 'text-success' : 'text-dim'}`}
                    >
                      {companionStatus?.connected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                </div>

                {companionTokens.length === 0 ? (
                  <button
                    onClick={async () => {
                      setGeneratingToken(true);
                      try {
                        const res = await api.companion.createToken('default');
                        setNewToken(res.token);
                        const [status, tokens] = await Promise.all([
                          api.companion.status(),
                          api.companion.listTokens(),
                        ]);
                        setCompanionStatus(status);
                        setCompanionTokens(tokens);
                      } catch (e: any) {
                        setError(e.message ?? 'Failed to generate token');
                      } finally {
                        setGeneratingToken(false);
                      }
                    }}
                    disabled={generatingToken}
                    className="w-full py-2 text-[13px] bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {generatingToken ? 'Generating...' : '+ Generate token'}
                  </button>
                ) : (
                  <div className="bg-surface-2 border border-border rounded-lg p-3 space-y-2">
                    <div className="text-[11px] text-muted mb-1">Connection token</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[12px] text-text font-mono">
                        {newToken ?? `${companionTokens[0].prefix}••••••••••`}
                      </code>
                      {newToken && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(newToken);
                            setCopiedToken(true);
                            setTimeout(() => setCopiedToken(false), 2000);
                          }}
                          className="text-[11px] text-accent hover:text-accent/80"
                        >
                          {copiedToken ? 'Copied!' : 'Copy'}
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          try {
                            await api.companion.revokeToken(companionTokens[0].id);
                            setNewToken(null);
                            setCompanionTokens(await api.companion.listTokens());
                          } catch (e: any) {
                            setError(e.message ?? 'Failed to revoke token');
                          }
                        }}
                        className="text-[11px] text-danger hover:text-danger/80"
                      >
                        Revoke
                      </button>
                    </div>
                    {newToken && (
                      <p className="text-[11px] text-warning">
                        Save this token — it won&apos;t be shown again.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Install instructions */}
              <div className="bg-surface border border-border rounded-xl p-5">
                <div className="text-[13px] font-semibold text-text mb-3">
                  Install &amp; connect
                </div>
                <pre className="bg-surface-2 border border-border rounded-lg p-3 text-[11px] text-success font-mono whitespace-pre overflow-x-auto">
                  {`npm install -g https://github.com/itseed/mesh-agent/releases/latest/download/meshagent-companion.tgz
mesh-companion connect ${process.env.NEXT_PUBLIC_API_URL ?? 'https://your-api.com'} --token <your-token>`}
                </pre>
              </div>
            </div>
          )}

          {/* CLI Providers tab */}
          {activeTab === 'providers' && (
            <section className="flex flex-col gap-4">
              <div className="mb-2">
                <h2 className="text-[14px] font-semibold text-text">CLI Providers</h2>
                <p className="text-[13px] text-muted mt-0.5">จัดการ CLI tools ที่ใช้รัน agent</p>
              </div>
              {providers.map((p) => (
                <div key={p.id} className="bg-surface border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[14px] font-semibold text-text">{p.name}</span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                          p.loggedIn
                            ? 'bg-success/10 border-success/25 text-success'
                            : 'bg-danger/10 border-danger/25 text-danger'
                        }`}
                      >
                        {p.loggedIn ? '● Logged in' : '○ Not logged in'}
                      </span>
                      {p.isDefault && (
                        <span className="text-[11px] bg-accent/10 border border-accent/25 text-accent px-2 py-0.5 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!p.isDefault && p.enabled && (
                        <button
                          onClick={async () => {
                            setProviders((prev) =>
                              prev.map((x) => ({ ...x, isDefault: x.id === p.id })),
                            );
                            try {
                              await api.settings.updateCliProvider(p.id, { isDefault: true });
                            } catch {
                              setProviders((prev) =>
                                prev.map((x) => ({
                                  ...x,
                                  isDefault: x.id === p.id ? false : x.isDefault,
                                })),
                              );
                            }
                          }}
                          className="text-[12px] text-muted hover:text-accent border border-border hover:border-accent/40 px-2.5 py-1 rounded transition-all"
                        >
                          Set default
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          const newEnabled = !p.enabled;
                          setProviders((prev) =>
                            prev.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    enabled: newEnabled,
                                    isDefault:
                                      x.isDefault && newEnabled
                                        ? x.isDefault
                                        : newEnabled
                                          ? x.isDefault
                                          : false,
                                  }
                                : x,
                            ),
                          );
                          try {
                            await api.settings.updateCliProvider(p.id, {
                              enabled: newEnabled,
                              ...(p.isDefault && !newEnabled ? { isDefault: false } : {}),
                            });
                          } catch {
                            setProviders((prev) =>
                              prev.map((x) =>
                                x.id === p.id
                                  ? { ...x, enabled: p.enabled, isDefault: p.isDefault }
                                  : x,
                              ),
                            );
                          }
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          p.enabled ? 'bg-accent' : 'bg-surface-2 border border-border'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            p.enabled ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div>
                    <button
                      onClick={() =>
                        setExpandedInstructions(expandedInstructions === p.id ? null : p.id)
                      }
                      className="text-[12px] text-accent hover:text-text transition-colors"
                    >
                      {expandedInstructions === p.id
                        ? '▾ Hide login instructions'
                        : '▸ Login instructions'}
                    </button>
                    {expandedInstructions === p.id && (
                      <pre className="mt-2 text-[12px] font-mono text-dim bg-canvas border border-border rounded p-3 whitespace-pre-wrap">
                        {p.loginInstructions}
                      </pre>
                    )}
                  </div>

                  {p.id === 'claude' && (
                    <>
                      <div className="mt-4 pt-4 border-t border-border">
                        <h3 className="text-[13px] font-semibold text-text mb-0.5">
                          Paste OAuth Token
                        </h3>
                        <p className="text-[12px] text-dim mb-3">
                          รัน <code className="font-mono text-muted">claude setup-token</code>{' '}
                          บนเครื่อง แล้ว copy token มาวางที่นี่
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            placeholder="Paste token here…"
                            value={oauthToken}
                            onChange={(e) => setOauthToken(e.target.value)}
                            className="flex-1 bg-canvas border border-border text-text text-[13px] rounded px-3 py-1.5 placeholder-dim"
                          />
                          <button
                            onClick={async () => {
                              if (!oauthToken.trim()) return;
                              setSavingToken(true);
                              setTokenError('');
                              try {
                                await new Promise((r) => setTimeout(r, 600));
                                setTokenInfo('บันทึก token แล้ว');
                                setOauthToken('');
                              } catch (e: any) {
                                setTokenError(e.message);
                              } finally {
                                setSavingToken(false);
                              }
                            }}
                            disabled={savingToken || !oauthToken.trim()}
                            className="text-[13px] bg-accent/90 hover:bg-accent text-canvas font-semibold px-4 py-1.5 rounded transition-colors disabled:opacity-40 shrink-0"
                          >
                            {savingToken ? '…' : 'Save'}
                          </button>
                        </div>
                        {tokenInfo && (
                          <p className="text-[12px] text-success mt-1.5">✓ {tokenInfo}</p>
                        )}
                        {tokenError && (
                          <p className="text-[12px] text-danger mt-1.5">✕ {tokenError}</p>
                        )}
                      </div>

                      {/* Test Claude CLI */}
                      <div className="mt-4 pt-4 border-t border-border">
                        <h3 className="text-[13px] font-semibold text-text mb-0.5">Test CLI</h3>
                        <p className="text-[12px] text-dim mb-3">
                          ตรวจสอบว่า claude binary ใน orchestrator container ทำงานได้
                        </p>
                        <button
                          onClick={testCli}
                          disabled={cliTesting}
                          className="text-[13px] bg-surface-2 hover:bg-canvas border border-border text-text px-4 py-2 rounded transition-colors disabled:opacity-40"
                        >
                          {cliTesting ? '…' : '▶ Test CLI'}
                        </button>
                        {cliTestResult && (
                          <div
                            className={`mt-2 p-3 rounded border text-[12px] font-mono ${
                              cliTestResult.ok
                                ? 'bg-success/5 border-success/20 text-success'
                                : 'bg-danger/5 border-danger/20 text-danger'
                            }`}
                          >
                            {cliTestResult.ok
                              ? `${cliTestResult.version}  (${cliTestResult.cmd})`
                              : cliTestResult.error}
                          </div>
                        )}
                        <p className="text-[12px] text-dim mt-2">
                          เปลี่ยน binary ได้โดยตั้ง{' '}
                          <code className="font-mono text-muted">CLAUDE_CMD</code> ใน orchestrator
                          environment แล้ว restart
                        </p>
                      </div>

                      {/* Repos Base Directory */}
                      <div className="mt-4 pt-4 border-t border-border">
                        <h3 className="text-[13px] font-semibold text-text mb-0.5">
                          Repos Base Directory
                        </h3>
                        <p className="text-[12px] text-dim mb-3">
                          root directory ที่ clone repos ไว้ — ใช้ auto-fill path เมื่อสร้าง project
                          เช่น <span className="font-mono text-muted">/home/ubuntu/repos</span>
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={reposBaseDir}
                            onChange={(e) => setReposBaseDir(e.target.value)}
                            placeholder="/home/ubuntu/repos"
                            className="flex-1 bg-canvas border border-border text-text text-[13px] rounded px-3 py-1.5 placeholder-dim font-mono"
                          />
                          <button
                            type="button"
                            onClick={saveBaseDir}
                            disabled={savingBaseDir}
                            className="text-[13px] bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent px-3 py-1.5 rounded transition-all disabled:opacity-50"
                          >
                            {savingBaseDir ? '…' : 'Save'}
                          </button>
                          {savedBaseDir && (
                            <button
                              type="button"
                              onClick={async () => {
                                await api.settings.resetReposBaseDir();
                                setSavedBaseDir(null);
                                setReposBaseDir('');
                              }}
                              className="text-[13px] text-muted hover:text-danger px-2 py-1.5 rounded transition-colors"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        {savedBaseDir && (
                          <p className="text-[12px] text-success mt-1.5">✓ {savedBaseDir}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        {/* Role form modal */}
        {showRoleForm && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-border-hi rounded-xl w-full max-w-lg p-5 glow-border fade-up max-h-[90vh] overflow-y-auto">
              <h2 className="text-[14px] font-semibold text-text mb-4">
                {editingRole ? 'Edit Skill' : 'New Skill'}
              </h2>
              {roleError && (
                <p className="text-danger text-[13px] mb-3 bg-danger/5 border border-danger/20 rounded px-3 py-2">
                  ✕ {roleError}
                </p>
              )}
              <form onSubmit={submitRole} className="flex flex-col gap-3">
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">
                    Slug *
                  </label>
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
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">
                    Name *
                  </label>
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
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={roleForm.description}
                    onChange={(e) => setRoleForm((p) => ({ ...p, description: e.target.value }))}
                    className={inputCls}
                    placeholder="Short description"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">
                    System Prompt
                  </label>
                  <textarea
                    value={roleForm.systemPrompt}
                    onChange={(e) => setRoleForm((p) => ({ ...p, systemPrompt: e.target.value }))}
                    rows={6}
                    className={`${inputCls} resize-none`}
                    placeholder="Instructions for this agent role…"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-muted uppercase tracking-wide mb-1">
                    Keywords
                  </label>
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
  );
}

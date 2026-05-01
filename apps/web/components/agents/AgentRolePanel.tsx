'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const ROLE_COLOR: Record<string, string> = {
  frontend: '#22d3ee',
  backend: '#60a5fa',
  mobile: '#c084fc',
  devops: '#4ade80',
  designer: '#f472b6',
  qa: '#fb923c',
  reviewer: '#f87171',
  lead: '#facc15',
};

const HIST_STATUS_STYLE: Record<string, { color: string; label: string }> = {
  completed: { color: '#3fb950', label: 'done' },
  errored: { color: '#f87171', label: 'error' },
  killed: { color: '#6a7a8e', label: 'stopped' },
  running: { color: '#f0883e', label: 'running' },
  pending: { color: '#fbbf24', label: 'pending' },
};

const CLI_PROVIDERS = [
  { id: 'claude', name: 'Claude', enabled: true, isDefault: true },
  { id: 'gemini', name: 'Gemini', enabled: false, isDefault: false },
  { id: 'cursor', name: 'Cursor', enabled: false, isDefault: false },
];

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}

interface AgentRolePanelProps {
  role: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    keywords: string[];
    isBuiltin: boolean;
    systemPrompt?: string;
  };
  session: { id: string; role: string; status: string } | null;
  history: any[];
  projects: any[];
  onClose: () => void;
  onDispatched: () => void;
  onViewOutput: (sessionId: string, role: string) => void;
}

export function AgentRolePanel({
  role,
  session,
  history,
  projects,
  onClose,
  onDispatched,
  onViewOutput,
}: AgentRolePanelProps) {
  const color = ROLE_COLOR[role.slug] ?? '#6a7a8e';
  const isRunning = !!session && (session.status === 'running' || session.status === 'pending');
  const isPending = session?.status === 'pending';

  const [showPrompt, setShowPrompt] = useState(false);
  const [dispatchProject, setDispatchProject] = useState('');
  const [dispatchPrompt, setDispatchPrompt] = useState('');

  useEffect(() => {
    if (projects.length > 0 && !dispatchProject) {
      setDispatchProject(projects[0].id);
    }
  }, [projects, dispatchProject]);
  const [dispatchDir, setDispatchDir] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [dispatchCli, setDispatchCli] = useState(
    CLI_PROVIDERS.find((p) => p.isDefault)?.id ?? 'claude',
  );
  const [dispatchError, setDispatchError] = useState('');

  const roleHistory = history.filter((s: any) => s.role === role.slug).slice(0, 5);

  async function handleDispatch() {
    if (!dispatchPrompt.trim()) return;
    setDispatching(true);
    setDispatchError('');
    try {
      await api.agents.dispatch({
        role: role.slug,
        workingDir: dispatchDir.trim() || process.cwd?.() || '.',
        prompt: dispatchPrompt.trim(),
        projectId: dispatchProject || undefined,
        cli: dispatchCli,
      });
      setDispatchPrompt('');
      setDispatchProject('');
      setDispatchDir('');
      onDispatched();
    } catch (e: any) {
      setDispatchError(e.message ?? 'Dispatch failed');
    } finally {
      setDispatching(false);
    }
  }

  async function handleStop() {
    if (!session) return;
    setStopping(true);
    try {
      await api.agents.stop(session.id);
      onDispatched();
    } catch {
      /* ignore */
    } finally {
      setStopping(false);
    }
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 z-30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-screen w-[480px] z-40 bg-surface border-l border-border-hi flex flex-col shadow-2xl fade-up">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
            style={{ backgroundColor: color + '15', color, border: '1px solid ' + color + '25' }}
          >
            {role.slug.slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-text">{role.name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-muted font-mono">{role.slug}</span>
              {isRunning && (
                <div className="flex items-center gap-1">
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-50" />
                    <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-success" />
                  </span>
                  <span className="text-[11px] text-success font-medium">
                    {isPending ? 'pending' : 'running'}
                  </span>
                </div>
              )}
              {!isRunning && <span className="text-[11px] text-dim">idle</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-[18px] leading-none px-1 transition-colors shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Section 1: Info */}
          <div className="px-5 py-4 border-b border-border">
            {role.description && (
              <p className="text-[13px] text-muted leading-relaxed mb-3">{role.description}</p>
            )}
            {role.keywords?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {role.keywords.map((k) => (
                  <span
                    key={k}
                    className="text-[11px] bg-surface-2 text-dim border border-border px-1.5 py-0.5 rounded"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
            {role.systemPrompt && (
              <div>
                <button
                  onClick={() => setShowPrompt((v) => !v)}
                  className="text-[12px] text-accent hover:text-text transition-colors"
                >
                  {showPrompt ? '▾ Hide system prompt' : '▸ Show system prompt'}
                </button>
                {showPrompt && (
                  <pre className="mt-2 text-[11px] text-dim font-mono bg-canvas border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {role.systemPrompt}
                  </pre>
                )}
              </div>
            )}
            {!role.description && !role.systemPrompt && role.keywords?.length === 0 && (
              <p className="text-[12px] text-dim italic">No description configured.</p>
            )}
          </div>

          {/* Section 2: Status / Output */}
          <div className="px-5 py-4 border-b border-border">
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-3">
              Status
            </div>
            {isRunning && session ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    onViewOutput(session.id, session.role);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/25 text-accent text-[13px] font-medium px-3 py-1.5 rounded transition-all"
                >
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-40" />
                    <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-accent" />
                  </span>
                  View live output
                </button>
                <button
                  onClick={handleStop}
                  disabled={stopping}
                  className="text-[13px] text-danger/70 hover:text-danger border border-danger/20 hover:border-danger/40 px-3 py-1.5 rounded transition-all disabled:opacity-40"
                >
                  {stopping ? '…' : 'Stop'}
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-dim">Idle — ready to dispatch</p>
            )}
          </div>

          {/* Section 3: Dispatch form */}
          <div className="px-5 py-4 border-b border-border">
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-3">
              Dispatch
            </div>
            {isRunning && (
              <p className="text-[12px] text-warning mb-3">
                A session is already running. Stop it first or dispatch after it finishes.
              </p>
            )}
            <div className="flex flex-col gap-2.5">
              <div>
                <label className="block text-[11px] text-muted uppercase tracking-wider mb-1">
                  CLI
                </label>
                <select
                  value={dispatchCli}
                  onChange={(e) => setDispatchCli(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 disabled:opacity-40"
                >
                  {CLI_PROVIDERS.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={!p.enabled}
                      style={!p.enabled ? { color: '#4a5568' } : undefined}
                    >
                      {p.name}
                      {!p.enabled ? ' (disabled)' : ''}
                      {p.isDefault ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <select
                value={dispatchProject}
                onChange={(e) => setDispatchProject(e.target.value)}
                disabled={isRunning}
                className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 disabled:opacity-40"
              >
                <option value="">— ไม่ระบุ —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Working directory (optional)"
                value={dispatchDir}
                onChange={(e) => setDispatchDir(e.target.value)}
                disabled={isRunning}
                className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 placeholder-dim disabled:opacity-40"
              />
              <textarea
                placeholder="Prompt — describe the task for this agent…"
                value={dispatchPrompt}
                onChange={(e) => setDispatchPrompt(e.target.value)}
                disabled={isRunning}
                rows={4}
                className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 placeholder-dim resize-none disabled:opacity-40"
              />
              {dispatchError && <p className="text-[12px] text-danger">✕ {dispatchError}</p>}
              <button
                onClick={handleDispatch}
                disabled={isRunning || dispatching || !dispatchPrompt.trim()}
                className="bg-accent/90 hover:bg-accent text-canvas text-[13px] font-semibold px-4 py-2 rounded transition-colors disabled:opacity-40 w-full"
              >
                {dispatching ? '…' : `Dispatch ${role.name}`}
              </button>
            </div>
          </div>

          {/* Section 4: Recent sessions */}
          {roleHistory.length > 0 && (
            <div className="px-5 py-4">
              <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-3">
                Recent Sessions
              </div>
              <div className="flex flex-col gap-1.5">
                {roleHistory.map((s: any) => {
                  const st = HIST_STATUS_STYLE[s.status] ?? { color: '#6a7a8e', label: s.status };
                  return (
                    <div
                      key={s.id}
                      className="flex items-start gap-2.5 px-3 py-2.5 bg-canvas border border-border rounded-lg"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                        style={{ backgroundColor: st.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-text truncate">
                          {s.prompt?.slice(0, 70)}
                          {s.prompt?.length > 70 ? '…' : ''}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] font-medium" style={{ color: st.color }}>
                            {st.label}
                          </span>
                          {s.durationMs && (
                            <span className="text-[11px] text-dim">
                              {(s.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                          <span className="text-[11px] text-dim">{relTime(s.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

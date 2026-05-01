'use client';
import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AgentGrid } from '@/components/agents/AgentGrid';
import { AgentOutputPanel } from '@/components/agents/AgentOutputPanel';
import { AuthGuard } from '@/components/layout/AuthGuard';
import { api } from '@/lib/api';
import { PageLoader } from '@/components/ui/PageLoader';

const HIST_STATUS_STYLE: Record<string, { color: string; label: string }> = {
  completed: { color: '#3fb950', label: 'done' },
  errored: { color: '#f87171', label: 'error' },
  killed: { color: '#6a7a8e', label: 'stopped' },
  running: { color: '#f0883e', label: 'running' },
  pending: { color: '#fbbf24', label: 'pending' },
};

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [outputPanel, setOutputPanel] = useState<{
    id: string;
    role: string;
    executionMode?: string;
  } | null>(null);
  const [sessionDetail, setSessionDetail] = useState<{
    id: string;
    role: string;
    executionMode?: string;
  } | null>(null);

  const HISTORY_PAGE = 20;
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [hasMore, setHasMore] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const [data, hist, roleList, projectList] = await Promise.all([
        api.agents.list(),
        api.agents.history(historyLimit),
        api.agents.listRoles(),
        api.projects.list(),
      ]);
      setAgents(data);
      setHistory(hist);
      setHasMore(hist.length === historyLimit);
      setRoles(roleList);
      setProjects(projectList);
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [historyLimit]);

  const handleLoadMore = useCallback(() => {
    setHistoryLimit((prev) => prev + HISTORY_PAGE);
  }, []);

  useEffect(() => {
    fetchAgents();
    const id = setInterval(fetchAgents, 5000);
    return () => clearInterval(id);
  }, [fetchAgents, historyLimit]);

  const running = agents.filter((a) => a.status === 'running' || a.status === 'pending').length;

  const historySection = history.length > 0 && (
    <div className="mt-8">
      <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-3">
        Recent Sessions
      </div>
      <div className="flex flex-col gap-1.5">
        {history.map((s: any) => {
          const st = HIST_STATUS_STYLE[s.status] ?? { color: '#6a7a8e', label: s.status };
          return (
            <div
              key={s.id}
              className="flex items-center gap-3 px-3 py-2.5 bg-surface border border-border rounded-lg hover:border-border-hi transition-colors cursor-pointer"
              onClick={() =>
                setSessionDetail({ id: s.id, role: s.role, executionMode: s.executionMode })
              }
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: st.color }}
              />
              <span className="text-[12px] font-mono bg-surface-2 border border-border px-1.5 py-0.5 rounded text-muted shrink-0">
                {s.role}
              </span>
              {s.executionMode === 'local' && (
                <span className="text-[10px] font-medium bg-success/15 text-success border border-success/25 px-1.5 py-0.5 rounded-full shrink-0">
                  local
                </span>
              )}
              <span className="text-[13px] text-text truncate flex-1">
                {s.prompt?.slice(0, 80)}
                {s.prompt?.length > 80 ? '…' : ''}
              </span>
              <span className="text-[12px] shrink-0 font-medium" style={{ color: st.color }}>
                {st.label}
              </span>
              {s.durationMs && (
                <span className="text-[12px] text-dim shrink-0">
                  {(s.durationMs / 1000).toFixed(1)}s
                </span>
              )}
              <span className="text-[12px] text-dim shrink-0">{relTime(s.createdAt)}</span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <button
          onClick={handleLoadMore}
          className="mt-3 w-full py-2 text-[13px] text-muted hover:text-text border border-border hover:border-border-hi rounded-lg transition-colors"
        >
          Load more
        </button>
      )}
    </div>
  );

  return (
    <AuthGuard>
      <AppShell>
        <div className="p-6 pb-24 fade-up">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-[15px] font-semibold text-text tracking-tight">Agents</h1>
              <p className="text-[13px] text-muted mt-0.5">
                {running > 0 ? (
                  <>
                    {running} running · {agents.length} total
                  </>
                ) : (
                  <>{agents.length} total — none running</>
                )}
              </p>
            </div>
            {running > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="relative inline-flex w-2 h-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-50" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
                </span>
                <span className="text-[13px] text-success">{running} active</span>
              </div>
            )}
          </div>

          {loading ? (
            <PageLoader />
          ) : error ? (
            <p className="text-danger text-[14px]">✕ {error}</p>
          ) : (
            <>
              <AgentGrid
                agents={agents}
                roles={roles}
                history={history}
                projects={projects}
                onRefresh={fetchAgents}
                onViewOutput={(id, role) =>
                  setOutputPanel({
                    id,
                    role,
                    executionMode: agents.find((a) => a.id === id)?.executionMode,
                  })
                }
              />
              {historySection}
            </>
          )}
        </div>
        {(outputPanel || sessionDetail) && (
          <AgentOutputPanel
            sessionId={(outputPanel ?? sessionDetail)!.id}
            role={(outputPanel ?? sessionDetail)!.role}
            executionMode={
              ((outputPanel ?? sessionDetail)!.executionMode ?? 'cloud') as 'cloud' | 'local'
            }
            onClose={() => {
              setOutputPanel(null);
              setSessionDetail(null);
            }}
          />
        )}
      </AppShell>
    </AuthGuard>
  );
}

'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

const STAGE_COLOR: Record<string, string> = {
  done: '#3fb950',
  in_progress: '#f0883e',
  review: '#60a5fa',
  backlog: '#6a7a8e',
};

interface Props {
  subtask: any;
  onClose: () => void;
}

export function SubtaskDetailModal({ subtask, onClose }: Props) {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [liveOutput, setLiveOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load session by task ID
  useEffect(() => {
    if (!subtask.id) return;
    setLoading(true);
    api.agents
      .sessionByTask(subtask.id)
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [subtask.id]);

  // Poll live output while in_progress (use session.id from agent_sessions)
  useEffect(() => {
    if (!session?.id || subtask.stage !== 'in_progress') return;
    const poll = async () => {
      try {
        const res = await api.agents.sessionOutput(session.id);
        setLiveOutput(res.output);
        setIsRunning(res.running);
        if (!res.running) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          // Reload session to get final outputLog saved to DB
          api.agents
            .sessionByTask(subtask.id)
            .then(setSession)
            .catch(() => {});
        }
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session?.id, subtask.stage, subtask.id]);

  const stageColor = STAGE_COLOR[subtask.stage] ?? '#6a7a8e';
  const displayOutput = liveOutput || session?.outputLog || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border-hi rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden glow-border fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span
              className="text-[12px] px-2 py-0.5 rounded font-medium"
              style={{ color: stageColor, backgroundColor: `${stageColor}20` }}
            >
              {subtask.stage ?? 'backlog'}
            </span>
            {subtask.agentRole && (
              <span className="text-[12px] font-mono bg-surface-2 border border-border px-1.5 py-0.5 rounded text-muted">
                {subtask.agentRole}
              </span>
            )}
            {isRunning && (
              <span className="text-[11px] text-[#f0883e] font-medium animate-pulse">● live</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-[14px] transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <h2 className="text-[15px] font-semibold text-text">{subtask.title}</h2>
          {subtask.description && <p className="text-[13px] text-muted">{subtask.description}</p>}

          {loading && <p className="text-dim text-[13px]">Loading session…</p>}

          {(session || liveOutput) && (
            <div>
              <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-2">
                Agent Output
                {isRunning && <span className="ml-2 text-[#f0883e] font-normal">— running</span>}
              </div>
              {displayOutput ? (
                <pre className="bg-canvas/50 border border-border rounded-lg p-3 text-[12px] font-mono text-muted whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                  {displayOutput}
                </pre>
              ) : (
                <p className="text-[13px] text-dim">Waiting for output…</p>
              )}
              {session && (
                <div className="flex gap-4 mt-2 text-[12px] text-dim">
                  {session.startedAt && (
                    <span>Started: {new Date(session.startedAt).toLocaleTimeString()}</span>
                  )}
                  {session.endedAt && (
                    <span>Ended: {new Date(session.endedAt).toLocaleTimeString()}</span>
                  )}
                  {session.exitCode != null && <span>Exit: {session.exitCode}</span>}
                  {session.role && <span className="font-mono">{session.role}</span>}
                </div>
              )}
            </div>
          )}

          {!loading && !session && !liveOutput && (
            <p className="text-dim text-[13px]">No agent session found for this subtask.</p>
          )}
        </div>
      </div>
    </div>
  );
}

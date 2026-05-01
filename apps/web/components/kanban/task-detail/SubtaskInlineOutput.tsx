'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { filterNoise } from './utils';

export function SubtaskInlineOutput({ taskId, stage }: { taskId: string; stage: string }) {
  const [session, setSession] = useState<any>(null);
  const [liveOutput, setLiveOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.agents
      .sessionByTask(taskId)
      .then(setSession)
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    if (!session?.id || stage !== 'in_progress') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await api.agents.sessionOutput(session.id);
        if (cancelled) return;
        setLiveOutput(res.output);
        setIsRunning(res.running);
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
        if (res.running) setTimeout(poll, 2000);
        else
          api.agents
            .sessionByTask(taskId)
            .then(setSession)
            .catch(() => {});
      } catch {
        if (!cancelled) setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [session?.id, stage, taskId]);

  const displayOutput = liveOutput || session?.outputLog || '';

  return (
    <div className="border-t border-border px-3 pb-3 pt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        {isRunning && <span className="text-[#f0883e] animate-pulse font-medium">● live</span>}
        {!isRunning && session && <span className="text-dim">completed</span>}
        {session?.startedAt && (
          <span className="text-dim">
            started {new Date(session.startedAt).toLocaleTimeString()}
          </span>
        )}
        {session?.endedAt && (
          <span className="text-dim">ended {new Date(session.endedAt).toLocaleTimeString()}</span>
        )}
        {session?.exitCode != null && (
          <span style={{ color: session.exitCode === 0 ? '#3fb950' : '#f87171' }}>
            exit {session.exitCode}
          </span>
        )}
      </div>
      {displayOutput ? (
        <pre
          ref={outputRef}
          className="bg-canvas border border-border rounded p-2.5 text-[11px] font-mono text-muted whitespace-pre-wrap break-all overflow-y-auto"
          style={{ maxHeight: '280px' }}
        >
          {filterNoise(displayOutput)}
        </pre>
      ) : (
        <p className="text-dim text-[12px]">
          {session ? 'Waiting for output…' : 'No session found.'}
        </p>
      )}
    </div>
  );
}

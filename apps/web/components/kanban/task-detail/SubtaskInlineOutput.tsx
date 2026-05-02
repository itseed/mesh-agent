'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { filterNoise } from './utils';

function OutputLine({ line }: { line: string }) {
  const toolMatch = line.match(/\[tool: ([^\]]+)\]/);
  if (toolMatch) {
    const before = line.slice(0, line.indexOf('[tool:'));
    const after = line.slice(line.indexOf(']') + 1);
    return (
      <span className="block leading-relaxed">
        {before && <span className="text-muted text-[11px]">{before}</span>}
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
          ⚙ {toolMatch[1]}
        </span>
        {after && <span className="text-muted text-[11px]">{after}</span>}
      </span>
    );
  }
  return <span className="block leading-relaxed text-muted text-[11px]">{line}</span>;
}

const MAX_LINES = 500;

export function SubtaskInlineOutput({ taskId, stage }: { taskId: string; stage: string }) {
  const [session, setSession] = useState<any>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    api.agents
      .sessionByTask(taskId)
      .then(setSession)
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    setLines([]);
    fromRef.current = 0;
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id || stage !== 'in_progress') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await api.agents.sessionOutput(session.id, fromRef.current);
        if (cancelled) return;

        const newText = res.output ?? '';
        if (newText) {
          const newLines = newText.split('\n').filter(Boolean);
          fromRef.current = res.total ?? fromRef.current + newLines.length;
          setLines((prev) => {
            const combined = [...prev, ...newLines];
            return combined.length > MAX_LINES ? combined.slice(-MAX_LINES) : combined;
          });
        }

        setIsRunning(res.running);
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
        if (res.running) setTimeout(poll, 2000);
        else api.agents.sessionByTask(taskId).then(setSession).catch(() => {});
      } catch {
        if (!cancelled) setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [session?.id, stage, taskId]);

  const displayLines =
    lines.length > 0
      ? lines
      : filterNoise(session?.outputLog ?? '')
          .split('\n')
          .filter(Boolean);

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
      {displayLines.length > 0 ? (
        <div
          ref={outputRef}
          className="bg-canvas border border-border rounded p-2.5 overflow-y-auto font-mono"
          style={{ maxHeight: '280px' }}
        >
          {displayLines.map((line, i) => (
            <OutputLine key={i} line={line} />
          ))}
        </div>
      ) : (
        <p className="text-dim text-[12px]">
          {session ? 'Waiting for output…' : 'No session found.'}
        </p>
      )}
    </div>
  );
}

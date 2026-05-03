'use client';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAgentOutput } from '@/lib/ws';
import { api, ApiError } from '@/lib/api';

const ROLE_COLOR: Record<string, string> = {
  frontend: '#22d3ee',
  backend: '#60a5fa',
  mobile: '#c084fc',
  devops: '#4ade80',
  designer: '#f472b6',
  qa: '#fb923c',
  reviewer: '#f87171',
};

function lineColor(line: string): string {
  const l = line.toLowerCase();
  if (/error|fail|fatal|exception|✕|✗/.test(l)) return '#f87171';
  if (/warn|warning/.test(l)) return '#fb923c';
  if (/success|done|complete|✓|✔|passed/.test(l)) return '#3fb950';
  if (/^\s*>|^\s*\$|^running|^building/.test(l)) return '#60a5fa';
  return '';
}

function isJsonNoise(line: string): boolean {
  const t = line.trim();
  return t.startsWith('{') && t.length > 200;
}

function OutputLine({ line }: { line: string }) {
  if (!line.trim()) return null;
  if (isJsonNoise(line)) return null;

  const toolMatch = line.match(/\[tool: ([^\]]+)\]/);
  if (toolMatch) {
    const before = line.slice(0, line.indexOf('[tool:'));
    const after = line.slice(line.indexOf(']') + 1);
    const color = lineColor(line);
    return (
      <div className="py-0.5" style={color ? { color } : {}}>
        {before && <span>{before}</span>}
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
          ⚙ {toolMatch[1]}
        </span>
        {after && <span>{after}</span>}
      </div>
    );
  }

  const color = lineColor(line);
  return (
    <div className="py-0.5 whitespace-pre-wrap break-all" style={color ? { color } : {}}>
      {line}
    </div>
  );
}

function useLocalAgentOutput(sessionId: string, enabled: boolean) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [companionError, setCompanionError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (!active) return;
      try {
        const res = await api.companion.agentStdout(sessionId);
        if (!active) return;
        setLines(res.output ? res.output.split('\n') : []);
        setCompanionError(false);
        if (!res.running) {
          setStatus('completed');
          return;
        }
        setStatus('running');
        timer = setTimeout(poll, 3000);
      } catch (e: unknown) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 503) {
          setCompanionError(true);
          return;
        }
        timer = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sessionId, enabled]);

  return { lines, status, companionError };
}

interface AgentOutputPanelProps {
  sessionId: string;
  role: string;
  executionMode?: 'cloud' | 'local';
  onClose: () => void;
}

export function AgentOutputPanel({
  sessionId,
  role,
  executionMode = 'cloud',
  onClose,
}: AgentOutputPanelProps) {
  const isLocal = executionMode === 'local';

  const { lines: wsLines, status: wsStatus } = useAgentOutput(isLocal ? null : sessionId);
  const {
    lines: pollLines,
    status: pollStatus,
    companionError,
  } = useLocalAgentOutput(sessionId, isLocal);

  const lines = isLocal ? pollLines : wsLines;
  const status = isLocal ? pollStatus : wsStatus;

  const roleColor = ROLE_COLOR[role] ?? '#6a7a8e';
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [killing, setKilling] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleKill() {
    setKilling(true);
    try {
      await api.companion.agentKill(sessionId);
    } catch {}
    setKilling(false);
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/30 z-30" onClick={onClose} />

      <div className="fixed right-0 top-0 h-screen w-full sm:w-[480px] bg-surface border-l border-border-hi z-40 flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-canvas/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-danger/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-warning/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
            </div>
            <span className="text-[14px] font-medium" style={{ color: roleColor }}>
              {role}
            </span>
            <span className="text-[13px] text-dim">
              — {isLocal ? 'Local output' : 'Live output'}
            </span>
            {isLocal && (
              <span className="text-[10px] font-medium bg-success/15 text-success border border-success/25 px-1.5 py-0.5 rounded-full">
                local
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-[14px] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Output */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 font-mono text-[13px] text-muted leading-relaxed scanlines bg-canvas/30">
          {companionError ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
              <span className="text-dim text-[20px]">⚡</span>
              <p className="text-[13px] text-muted">Companion not connected — output unavailable</p>
              <p className="text-[12px] text-dim">
                Open Settings → Companion to connect your local machine
              </p>
            </div>
          ) : lines.length === 0 ? (
            <span className="text-dim">
              Waiting for output<span className="cursor-blink">▋</span>
            </span>
          ) : (
            lines.map((line: string, i: number) => <OutputLine key={i} line={line} />)
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-[12px] text-dim flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            {status === 'running' && (
              <span className="relative inline-flex w-1.5 h-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-success" />
              </span>
            )}
            <span>
              {lines.length} lines
              {status && (
                <>
                  {' '}
                  · <span className="text-muted">{status}</span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isLocal && status === 'running' && !companionError && (
              <button
                onClick={handleKill}
                disabled={killing}
                className="text-[12px] text-danger/70 hover:text-danger border border-danger/20 hover:border-danger/50 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
              >
                {killing ? '…' : '■ Kill'}
              </button>
            )}
            <button
              onClick={() => {
                navigator.clipboard.writeText(lines.join('\n'));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="text-[12px] text-dim hover:text-muted transition-colors"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <span>session: {sessionId.slice(0, 8)}…</span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

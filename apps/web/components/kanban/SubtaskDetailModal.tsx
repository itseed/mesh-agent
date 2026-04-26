'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

const STAGE_COLOR: Record<string, string> = {
  done: '#3fb950',
  in_progress: '#f0883e',
  review: '#60a5fa',
  backlog: '#6a7a8e',
}

interface Props {
  subtask: any
  onClose: () => void
}

export function SubtaskDetailModal({ subtask, onClose }: Props) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!subtask.sessionId) return
    setLoading(true)
    api.agents.session(subtask.sessionId)
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [subtask.sessionId])

  const stageColor = STAGE_COLOR[subtask.stage] ?? '#6a7a8e'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border-hi rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden glow-border fade-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] px-2 py-0.5 rounded font-medium" style={{ color: stageColor, backgroundColor: `${stageColor}20` }}>
              {subtask.stage ?? 'backlog'}
            </span>
            {subtask.agentRole && (
              <span className="text-[12px] font-mono bg-surface-2 border border-border px-1.5 py-0.5 rounded text-muted">
                {subtask.agentRole}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-[14px] transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Title */}
          <h2 className="text-[15px] font-semibold text-text">{subtask.title}</h2>
          {subtask.description && (
            <p className="text-[13px] text-muted">{subtask.description}</p>
          )}

          {/* Session output */}
          {loading && <p className="text-dim text-[13px]">Loading output…</p>}
          {session && (
            <div>
              <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-2">Agent Output</div>
              {session.outputLog ? (
                <pre className="bg-canvas/50 border border-border rounded-lg p-3 text-[12px] font-mono text-muted whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                  {session.outputLog}
                </pre>
              ) : (
                <p className="text-[13px] text-dim">No output recorded.</p>
              )}
              <div className="flex gap-4 mt-2 text-[12px] text-dim">
                {session.startedAt && <span>Started: {new Date(session.startedAt).toLocaleTimeString()}</span>}
                {session.endedAt && <span>Ended: {new Date(session.endedAt).toLocaleTimeString()}</span>}
                {session.exitCode != null && <span>Exit: {session.exitCode}</span>}
              </div>
            </div>
          )}
          {!loading && !session && subtask.sessionId && (
            <p className="text-dim text-[13px]">Session output not available.</p>
          )}
          {!subtask.sessionId && (
            <p className="text-dim text-[13px]">No session linked to this subtask.</p>
          )}
        </div>
      </div>
    </div>
  )
}

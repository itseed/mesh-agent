'use client';
import type { ReviewIssue } from './styles';
import { ROLE_STYLE } from './styles';
import { Markdown } from './Markdown';
import { FixIssuesPanel } from './FixIssuesPanel';
import { parseReviewIssues } from './utils';

interface CommentsTabProps {
  comments: any[];
  fixCommentId: string | null;
  selectedIssues: Set<number>;
  fixingIssues: boolean;
  onOpenFixPanel: (commentId: string, issues: ReviewIssue[]) => void;
  onToggleIssue: (idx: number) => void;
  onSelectAllIssues: (issues: ReviewIssue[]) => void;
  onConfirmFix: () => void;
  onCancelFix: () => void;
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-gray-500/20 text-gray-400',
};

function LeadCommentBody({ body }: { body: string }) {
  let parsed: any = null;
  try {
    parsed = JSON.parse(body);
  } catch {}
  if (!parsed) return <div className="text-[13px] text-text whitespace-pre-wrap">{body}</div>;
  return (
    <div className="flex flex-col gap-1">
      {parsed.summary && <p className="text-[13px] text-text/80 italic mb-2">{parsed.summary}</p>}
      {Array.isArray(parsed.subtasks) &&
        parsed.subtasks.map((st: any, idx: number) => {
          const role = ROLE_STYLE[st.agentRole ?? ''];
          return (
            <div
              key={idx}
              className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0"
            >
              <span className="text-[13px] text-text flex-1">{st.title}</span>
              {st.agentRole && role && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                  style={{ backgroundColor: role.bg, color: role.text }}
                >
                  {st.agentRole}
                </span>
              )}
              {st.priority && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                    PRIORITY_BADGE[st.priority] ?? 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {st.priority}
                </span>
              )}
              {st.wave > 1 && <span className="text-[10px] text-dim shrink-0">W{st.wave}</span>}
            </div>
          );
        })}
    </div>
  );
}

export function CommentsTab({
  comments,
  fixCommentId,
  selectedIssues,
  fixingIssues,
  onOpenFixPanel,
  onToggleIssue,
  onSelectAllIssues,
  onConfirmFix,
  onCancelFix,
}: CommentsTabProps) {
  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 && <p className="text-muted text-[13px]">No comments yet.</p>}
      {comments.map((c: any, i: number) => (
        <div
          key={c.id ?? i}
          className={
            c.source === 'lead'
              ? 'border-l-2 border-accent/60 bg-accent/5 rounded-r px-3 py-2'
              : c.source === 'agent'
                ? 'rounded border border-accent/20 bg-canvas/50 px-3 py-2'
                : 'bg-surface-2 rounded border border-border px-3 py-2'
          }
        >
          {c.source === 'lead' && (
            <div className="text-[11px] text-accent font-semibold mb-1 uppercase tracking-wide">
              Lead AI
            </div>
          )}
          {c.source === 'agent' &&
            (() => {
              const issues = parseReviewIssues(c.body);
              return (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[11px] text-accent font-medium">🤖 Agent Summary</div>
                    {issues.length > 0 && fixCommentId !== c.id && (
                      <button
                        onClick={() => onOpenFixPanel(c.id, issues)}
                        className="text-[11px] px-2 py-0.5 rounded border border-orange-400/30 text-orange-300 hover:bg-orange-400/10 transition-colors"
                      >
                        🔧 Fix Issues ({issues.length})
                      </button>
                    )}
                  </div>
                  <div className="text-[13px] text-text">
                    <Markdown body={c.body} />
                  </div>
                  {issues.length > 0 && fixCommentId !== c.id && (
                    <button
                      onClick={() => onOpenFixPanel(c.id, issues)}
                      className="mt-2 text-[11px] px-2 py-1 rounded border border-orange-400/30 text-orange-300 hover:bg-orange-400/10 transition-colors w-full"
                    >
                      🔧 Fix {issues.length} Issue{issues.length !== 1 ? 's' : ''} — เลือก &amp;
                      สร้าง Task
                    </button>
                  )}
                  {fixCommentId === c.id && (
                    <div className="mt-3">
                      <FixIssuesPanel
                        title="เลือก Issues ที่ต้องการแก้"
                        issues={issues}
                        selected={selectedIssues}
                        onToggle={onToggleIssue}
                        onSelectAll={() => onSelectAllIssues(issues)}
                        onConfirm={onConfirmFix}
                        onCancel={onCancelFix}
                        busy={fixingIssues}
                        showSelectAll={issues.length > 1}
                      />
                    </div>
                  )}
                </>
              );
            })()}
          {c.source === 'lead' && <LeadCommentBody body={c.body} />}
          {c.source === 'user' && (
            <div className="text-[13px] text-text whitespace-pre-wrap">{c.body}</div>
          )}
          {c.createdAt && (
            <div className="text-[11px] text-dim mt-2">
              {new Date(c.createdAt).toLocaleString()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

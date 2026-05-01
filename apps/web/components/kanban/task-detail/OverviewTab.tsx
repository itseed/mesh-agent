'use client'
import type { ReviewIssue } from './styles'
import { ROLE_STYLE, PRIORITY_BG, PRIORITY_TEXT, SEVERITY_STYLE } from './styles'
import { FixIssuesPanel } from './FixIssuesPanel'

interface OverviewTabProps {
  localTask: any
  descValue: string
  editingDesc: boolean
  onEditDesc: () => void
  onChangeDesc: (v: string) => void
  onSaveDesc: () => void
  onUpdateField: (field: string, value: string) => void
  // AI section
  leadComment: any
  plan: any
  analyzing: boolean
  approving: boolean
  onAnalyze: () => void
  onApprove: () => void
  // Task Complete
  doneCount: number
  totalCount: number
  allIssues: ReviewIssue[]
  fixCommentId: string | null
  fixTasksCreatedCount: number
  selectedIssues: Set<number>
  fixingIssues: boolean
  onSwitchToSubtasks: () => void
  onOpenOverviewFix: (issues: ReviewIssue[]) => void
  onToggleIssue: (idx: number) => void
  onSelectAllIssues: (issues: ReviewIssue[]) => void
  onConfirmFix: () => void
  onCancelFix: () => void
}

export function OverviewTab(props: OverviewTabProps) {
  const {
    localTask,
    descValue,
    editingDesc,
    onEditDesc,
    onChangeDesc,
    onSaveDesc,
    onUpdateField,
    leadComment,
    plan,
    analyzing,
    approving,
    onAnalyze,
    onApprove,
    doneCount,
    totalCount,
    allIssues,
    fixCommentId,
    fixTasksCreatedCount,
    selectedIssues,
    fixingIssues,
    onSwitchToSubtasks,
    onOpenOverviewFix,
    onToggleIssue,
    onSelectAllIssues,
    onConfirmFix,
    onCancelFix,
  } = props

  return (
    <div className="flex flex-col gap-4">
      {/* Description */}
      <div>
        <div className="text-[12px] text-muted uppercase tracking-wide mb-1">Description</div>
        {editingDesc ? (
          <textarea
            value={descValue}
            onChange={(e) => onChangeDesc(e.target.value)}
            onBlur={onSaveDesc}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSaveDesc()
            }}
            autoFocus
            rows={4}
            className="w-full bg-canvas border border-border-hi text-text text-[14px] rounded px-3 py-2 resize-none placeholder-dim"
            placeholder="Add a description…"
          />
        ) : (
          <div
            onClick={onEditDesc}
            className="text-[14px] text-text cursor-text min-h-[48px] rounded px-3 py-2 bg-canvas/50 hover:bg-canvas border border-transparent hover:border-border transition-all whitespace-pre-wrap"
          >
            {descValue || <span className="text-dim">Click to add description…</span>}
          </div>
        )}
      </div>

      {/* Role + Priority */}
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[12px] text-muted uppercase tracking-wide mb-1.5">Agent Role</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onUpdateField('agentRole', '')}
              className={`text-[12px] px-2 py-1 rounded border transition-all ${
                !localTask.agentRole
                  ? 'bg-surface-2 border-border-hi text-text'
                  : 'border-border text-dim hover:border-border-hi hover:text-muted'
              }`}
            >
              —
            </button>
            {Object.entries(ROLE_STYLE).map(([r, style]) => (
              <button
                key={r}
                type="button"
                onClick={() => onUpdateField('agentRole', r)}
                className={`text-[12px] px-2 py-1 rounded border font-medium transition-all ${
                  localTask.agentRole === r
                    ? 'border-transparent'
                    : 'border-border bg-transparent text-dim hover:border-border-hi'
                }`}
                style={
                  localTask.agentRole === r
                    ? { backgroundColor: style.bg, color: style.text, borderColor: style.text + '40' }
                    : {}
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-muted uppercase tracking-wide mb-1.5">Priority</div>
          <div className="flex gap-1.5">
            {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onUpdateField('priority', p)}
                className={`flex-1 text-[12px] px-2 py-1 rounded border font-medium capitalize transition-all ${
                  localTask.priority === p
                    ? 'border-transparent'
                    : 'border-border bg-transparent text-dim hover:border-border-hi'
                }`}
                style={
                  localTask.priority === p
                    ? {
                        backgroundColor: PRIORITY_BG[p],
                        color: PRIORITY_TEXT[p],
                        borderColor: PRIORITY_TEXT[p] + '40',
                      }
                    : {}
                }
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Analysis */}
      <div className="border border-border rounded-lg p-3">
        <div className="text-[12px] text-muted uppercase tracking-wide mb-2">AI Analysis</div>
        {!leadComment ? (
          <button
            onClick={onAnalyze}
            disabled={analyzing}
            className="flex items-center gap-2 bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent text-[13px] px-3 py-1.5 rounded transition-all disabled:opacity-50"
          >
            <span>{analyzing ? '…' : '✦'}</span>
            {analyzing ? 'Analyzing…' : 'Analyze with AI'}
          </button>
        ) : plan ? (
          <div className="flex flex-col gap-3">
            {plan.summary && <p className="text-[13px] text-text">{plan.summary}</p>}
            {Array.isArray(plan.subtasks) && plan.subtasks.length > 0 && (
              <ol className="flex flex-col gap-1.5 list-none">
                {plan.subtasks.map((st: any, i: number) => {
                  const role = ROLE_STYLE[st.agentRole ?? '']
                  return (
                    <li key={i} className="flex items-center gap-2 text-[13px]">
                      <span className="text-dim shrink-0">{i + 1}.</span>
                      <span className="text-text flex-1">{st.title}</span>
                      {st.agentRole && role && (
                        <span
                          className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ backgroundColor: role.bg, color: role.text }}
                        >
                          {st.agentRole}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
            <button
              onClick={onApprove}
              disabled={approving}
              className="self-start flex items-center gap-2 bg-success/10 hover:bg-success/20 border border-success/20 text-success text-[13px] px-3 py-1.5 rounded transition-all disabled:opacity-50"
            >
              {approving ? '…' : '✓ Approve Plan'}
            </button>
          </div>
        ) : (
          <div className="text-[13px] text-muted whitespace-pre-wrap">{leadComment.body}</div>
        )}
      </div>

      {/* Task Complete CTA */}
      {localTask.stage === 'done' && (
        <div className="border border-success/30 bg-success/5 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-success">✓</span>
              <div className="text-[12px] text-success font-semibold uppercase tracking-wide">
                Task Complete
              </div>
            </div>
            {totalCount > 0 && (
              <button
                onClick={onSwitchToSubtasks}
                className="text-[11px] text-muted hover:text-text transition-colors"
              >
                {doneCount}/{totalCount} subtasks →
              </button>
            )}
          </div>

          {allIssues.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-text/80">
                พบ {allIssues.length} issue{allIssues.length !== 1 ? 's' : ''} จาก agent review
              </p>
              <div className="flex flex-col gap-1">
                {allIssues.slice(0, 5).map((issue, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0"
                      style={SEVERITY_STYLE[issue.severity]}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-[12px] text-text truncate">{issue.title}</span>
                  </div>
                ))}
                {allIssues.length > 5 && (
                  <span className="text-[11px] text-dim">+{allIssues.length - 5} more</span>
                )}
              </div>
              {fixCommentId !== '__overview__' ? (
                fixTasksCreatedCount > 0 ? (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[12px] text-success">
                      ✓ {fixTasksCreatedCount} fix task{fixTasksCreatedCount !== 1 ? 's' : ''} created
                    </span>
                    <button
                      onClick={onSwitchToSubtasks}
                      className="text-[11px] text-accent hover:underline"
                    >
                      View →
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onOpenOverviewFix(allIssues)}
                    className="self-start mt-1 text-[12px] px-3 py-1.5 rounded border border-orange-400/30 text-orange-300 hover:bg-orange-400/10 transition-colors"
                  >
                    🔧 Create Fix Tasks ({allIssues.length})
                  </button>
                )
              ) : (
                <FixIssuesPanel
                  issues={allIssues}
                  selected={selectedIssues}
                  onToggle={onToggleIssue}
                  onSelectAll={() => onSelectAllIssues(allIssues)}
                  onConfirm={onConfirmFix}
                  onCancel={onCancelFix}
                  busy={fixingIssues}
                />
              )}
            </div>
          ) : totalCount > 0 ? (
            <div className="flex items-center gap-2">
              <p className="text-[13px] text-text/70">All {doneCount} subtasks completed</p>
              <button
                onClick={onSwitchToSubtasks}
                className="text-[11px] text-accent hover:underline"
              >
                View →
              </button>
            </div>
          ) : (
            <p className="text-[13px] text-text/70">No issues detected.</p>
          )}
        </div>
      )}
    </div>
  )
}

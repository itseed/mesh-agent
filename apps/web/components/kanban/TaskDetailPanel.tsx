'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-dim',
}

const ROLE_STYLE: Record<string, { bg: string; text: string }> = {
  frontend: { bg: 'rgba(34,211,238,0.1)',  text: '#22d3ee' },
  backend:  { bg: 'rgba(96,165,250,0.1)',  text: '#60a5fa' },
  mobile:   { bg: 'rgba(192,132,252,0.1)', text: '#c084fc' },
  devops:   { bg: 'rgba(74,222,128,0.1)',  text: '#4ade80' },
  designer: { bg: 'rgba(244,114,182,0.1)', text: '#f472b6' },
  qa:       { bg: 'rgba(251,146,60,0.1)',  text: '#fb923c' },
  reviewer: { bg: 'rgba(248,113,113,0.1)', text: '#f87171' },
}

const PRIORITY_BG: Record<string, string> = {
  urgent: 'rgba(248,113,113,0.15)',
  high:   'rgba(251,146,60,0.15)',
  medium: 'rgba(251,191,36,0.15)',
  low:    'rgba(55,69,86,0.3)',
}
const PRIORITY_TEXT: Record<string, string> = {
  urgent: '#f87171',
  high:   '#fb923c',
  medium: '#fbbf24',
  low:    '#6a7a8e',
}

const STAGE_COLORS: Record<string, string> = {
  backlog: '#6a7a8e',
  in_progress: '#f0883e',
  review: '#d2a8ff',
  done: '#3fb950',
}

interface TaskDetailPanelProps {
  task: any
  allTasks: any[]
  onClose: () => void
  onUpdate: () => void
  onDelete: (id: string) => void
}

type Tab = 'overview' | 'comments' | 'subtasks' | 'activity'

export function TaskDetailPanel({ task, allTasks, onClose, onUpdate, onDelete }: TaskDetailPanelProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [comments, setComments] = useState<any[]>([])
  const [activities, setActivities] = useState<any[]>([])
  const [commentText, setCommentText] = useState('')
  const [sending, setSending] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [localTask, setLocalTask] = useState(task)
  const [descValue, setDescValue] = useState(task.description ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskRole, setSubtaskRole] = useState('')

  useEffect(() => {
    setLocalTask(task)
    setDescValue(task.description ?? '')
  }, [task])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Fetch comments on mount for overview AI section + comments tab
  useEffect(() => {
    api.tasks.comments(task.id).then(setComments).catch(() => {})
  }, [task.id])

  useEffect(() => {
    if (tab === 'activity') {
      api.tasks.activities(task.id).then(setActivities).catch(() => {})
    }
    if (tab === 'comments') {
      api.tasks.comments(task.id).then(setComments).catch(() => {})
    }
  }, [tab, task.id])

  const subtasks = allTasks.filter((t: any) => t.parentTaskId === task.id)

  async function saveDescription() {
    setEditingDesc(false)
    if (descValue === localTask.description) return
    try {
      await api.tasks.update(task.id, { description: descValue })
      setLocalTask((prev: any) => ({ ...prev, description: descValue }))
      onUpdate()
    } catch {}
  }

  async function updateField(field: string, value: string) {
    try {
      await api.tasks.update(task.id, { [field]: value })
      setLocalTask((prev: any) => ({ ...prev, [field]: value }))
      onUpdate()
    } catch {}
  }

  async function sendComment() {
    if (!commentText.trim()) return
    setSending(true)
    try {
      await api.tasks.addComment(task.id, commentText.trim())
      setCommentText('')
      const fresh = await api.tasks.comments(task.id)
      setComments(fresh)
    } catch {} finally {
      setSending(false)
    }
  }

  async function analyze() {
    setAnalyzing(true)
    try {
      await api.tasks.analyze(task.id)
      const fresh = await api.tasks.comments(task.id)
      setComments(fresh)
      onUpdate()
    } catch {} finally {
      setAnalyzing(false)
    }
  }

  async function approve() {
    setApproving(true)
    try {
      await api.tasks.approve(task.id)
      onUpdate()
    } catch {} finally {
      setApproving(false)
    }
  }

  async function createSubtask(e: React.FormEvent) {
    e.preventDefault()
    if (!subtaskTitle.trim()) return
    try {
      await api.tasks.createSubtask(task.id, {
        title: subtaskTitle.trim(),
        agentRole: subtaskRole || undefined,
      })
      setSubtaskTitle('')
      setSubtaskRole('')
      setShowSubtaskForm(false)
      onUpdate()
    } catch {}
  }

  const leadComment = comments.find((c: any) => c.source === 'lead')
  let plan: any = null
  if (leadComment) {
    try { plan = JSON.parse(leadComment.body) } catch {}
  }

  const TABS: Tab[] = ['overview', 'comments', 'subtasks', 'activity']

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-30" onClick={onClose} />

      <div className="fixed right-0 top-0 h-screen w-[480px] bg-surface border-l border-border-hi z-40 flex flex-col transition-transform duration-200">
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {localTask.priority && (
                <span className={`text-[12px] font-semibold uppercase tracking-wide ${PRIORITY_COLORS[localTask.priority] ?? 'text-dim'}`}>
                  {localTask.priority}
                </span>
              )}
              {localTask.stage && (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    color: STAGE_COLORS[localTask.stage] ?? '#6a7a8e',
                    backgroundColor: `${STAGE_COLORS[localTask.stage] ?? '#6a7a8e'}20`,
                  }}
                >
                  {localTask.stage}
                </span>
              )}
            </div>
            <h2 className="text-[15px] font-semibold text-text leading-snug">{localTask.title}</h2>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[12px] text-danger">ลบ?</span>
              <button
                onClick={async () => { await onDelete(task.id); onClose() }}
                className="text-[12px] text-danger border border-danger/30 px-2 py-1 rounded hover:bg-danger/10 transition-colors"
              >
                ยืนยัน
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[12px] text-muted hover:text-text transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-dim hover:text-danger text-[13px] transition-colors shrink-0"
              title="Delete task"
            >
              🗑
            </button>
          )}
          <button onClick={onClose} className="text-muted hover:text-text text-[18px] leading-none mt-0.5 shrink-0">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[13px] px-4 py-2 border-b-2 capitalize transition-colors ${
                tab === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-[12px] text-muted uppercase tracking-wide mb-1">Description</div>
                {editingDesc ? (
                  <textarea
                    value={descValue}
                    onChange={(e) => setDescValue(e.target.value)}
                    onBlur={saveDescription}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveDescription() }}
                    autoFocus
                    rows={4}
                    className="w-full bg-canvas border border-border-hi text-text text-[14px] rounded px-3 py-2 resize-none placeholder-dim"
                    placeholder="Add a description…"
                  />
                ) : (
                  <div
                    onClick={() => setEditingDesc(true)}
                    className="text-[14px] text-text cursor-text min-h-[48px] rounded px-3 py-2 bg-canvas/50 hover:bg-canvas border border-transparent hover:border-border transition-all whitespace-pre-wrap"
                  >
                    {descValue || <span className="text-dim">Click to add description…</span>}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-[12px] text-muted uppercase tracking-wide mb-1.5">Agent Role</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateField('agentRole', '')}
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
                        onClick={() => updateField('agentRole', r)}
                        className={`text-[12px] px-2 py-1 rounded border font-medium transition-all ${
                          localTask.agentRole === r
                            ? 'border-transparent'
                            : 'border-border bg-transparent text-dim hover:border-border-hi'
                        }`}
                        style={localTask.agentRole === r
                          ? { backgroundColor: style.bg, color: style.text, borderColor: style.text + '40' }
                          : {}}
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
                        onClick={() => updateField('priority', p)}
                        className={`flex-1 text-[12px] px-2 py-1 rounded border font-medium capitalize transition-all ${
                          localTask.priority === p
                            ? 'border-transparent'
                            : 'border-border bg-transparent text-dim hover:border-border-hi'
                        }`}
                        style={localTask.priority === p
                          ? { backgroundColor: PRIORITY_BG[p], color: PRIORITY_TEXT[p], borderColor: PRIORITY_TEXT[p] + '40' }
                          : {}}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI section */}
              <div className="border border-border rounded-lg p-3">
                <div className="text-[12px] text-muted uppercase tracking-wide mb-2">AI Analysis</div>
                {!leadComment ? (
                  <button
                    onClick={analyze}
                    disabled={analyzing}
                    className="flex items-center gap-2 bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent text-[13px] px-3 py-1.5 rounded transition-all disabled:opacity-50"
                  >
                    <span>{analyzing ? '…' : '✦'}</span>
                    {analyzing ? 'Analyzing…' : 'Analyze with AI'}
                  </button>
                ) : plan ? (
                  <div className="flex flex-col gap-3">
                    {plan.summary && (
                      <p className="text-[13px] text-text">{plan.summary}</p>
                    )}
                    {Array.isArray(plan.subtasks) && plan.subtasks.length > 0 && (
                      <ol className="flex flex-col gap-1.5 list-none">
                        {plan.subtasks.map((st: any, i: number) => {
                          const role = ROLE_STYLE[st.agentRole ?? '']
                          return (
                            <li key={i} className="flex items-center gap-2 text-[13px]">
                              <span className="text-dim shrink-0">{i + 1}.</span>
                              <span className="text-text flex-1">{st.title}</span>
                              {st.agentRole && role && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: role.bg, color: role.text }}>
                                  {st.agentRole}
                                </span>
                              )}
                            </li>
                          )
                        })}
                      </ol>
                    )}
                    <button
                      onClick={approve}
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
            </div>
          )}

          {/* ── Comments ── */}
          {tab === 'comments' && (
            <div className="flex flex-col gap-3">
              {comments.length === 0 && (
                <p className="text-muted text-[13px]">No comments yet.</p>
              )}
              {comments.map((c: any, i: number) => (
                <div
                  key={c.id ?? i}
                  className={
                    c.source === 'lead'
                      ? 'border-l-2 border-accent/60 bg-accent/5 rounded-r px-3 py-2'
                      : 'bg-surface-2 rounded px-3 py-2'
                  }
                >
                  {c.source === 'lead' && (
                    <div className="text-[11px] text-accent font-semibold mb-1 uppercase tracking-wide">Lead AI</div>
                  )}
                  <div className="text-[13px] text-text whitespace-pre-wrap">{c.body}</div>
                  {c.createdAt && (
                    <div className="text-[11px] text-dim mt-1">{new Date(c.createdAt).toLocaleString()}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Subtasks ── */}
          {tab === 'subtasks' && (
            <div className="flex flex-col gap-2">
              {subtasks.length === 0 && !showSubtaskForm && (
                <p className="text-muted text-[13px]">No subtasks yet.</p>
              )}
              {subtasks.map((st: any) => {
                const role = ROLE_STYLE[st.agentRole ?? '']
                return (
                  <div key={st.id} className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded border border-border">
                    <span
                      className="text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{
                        color: STAGE_COLORS[st.stage] ?? '#6a7a8e',
                        backgroundColor: `${STAGE_COLORS[st.stage] ?? '#6a7a8e'}20`,
                      }}
                    >
                      {st.stage ?? 'backlog'}
                    </span>
                    <span className="text-[13px] text-text flex-1">{st.title}</span>
                    {st.agentRole && role && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: role.bg, color: role.text }}>
                        {st.agentRole}
                      </span>
                    )}
                  </div>
                )
              })}

              {showSubtaskForm ? (
                <form onSubmit={createSubtask} className="flex flex-col gap-2 mt-1 p-3 bg-canvas rounded border border-border">
                  <input
                    type="text"
                    placeholder="Subtask title"
                    value={subtaskTitle}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    className="w-full bg-surface border border-border text-text text-[13px] rounded px-2 py-1.5 placeholder-dim"
                    autoFocus
                    required
                  />
                  <select
                    value={subtaskRole}
                    onChange={(e) => setSubtaskRole(e.target.value)}
                    className="w-full bg-surface border border-border text-text text-[13px] rounded px-2 py-1.5"
                  >
                    <option value="">No role</option>
                    {Object.keys(ROLE_STYLE).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowSubtaskForm(false)} className="text-muted text-[13px] hover:text-text">Cancel</button>
                    <button type="submit" className="bg-accent/15 hover:bg-accent/25 text-accent text-[13px] px-3 py-1 rounded border border-accent/20">Add</button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowSubtaskForm(true)}
                  className="flex items-center gap-1.5 text-[13px] text-muted hover:text-accent transition-colors mt-1"
                >
                  <span className="text-[16px] leading-none">+</span> Add subtask
                </button>
              )}
            </div>
          )}

          {/* ── Activity ── */}
          {tab === 'activity' && (
            <div className="flex flex-col gap-3">
              {activities.length === 0 && (
                <p className="text-muted text-[13px]">No activity yet.</p>
              )}
              {activities.map((a: any, i: number) => (
                <div key={a.id ?? i} className="flex gap-3 text-[13px]">
                  <div className="w-1.5 h-1.5 rounded-full bg-dim mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <span className="text-text">{a.type}</span>
                    {a.payload != null && (
                      <span className="text-muted ml-1.5">
                        {typeof a.payload === 'string' ? a.payload : JSON.stringify(a.payload)}
                      </span>
                    )}
                    {a.createdAt && (
                      <div className="text-[11px] text-dim mt-0.5">{new Date(a.createdAt).toLocaleString()}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comment input (pinned bottom) */}
        {tab === 'comments' && (
          <div className="p-4 border-t border-border shrink-0">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              className="w-full bg-canvas border border-border text-text text-[13px] rounded px-3 py-2 resize-none placeholder-dim mb-2"
            />
            <div className="flex justify-end">
              <button
                onClick={sendComment}
                disabled={sending || !commentText.trim()}
                className="bg-accent/15 hover:bg-accent/25 text-accent text-[13px] px-3 py-1.5 rounded border border-accent/20 disabled:opacity-40 transition-all"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

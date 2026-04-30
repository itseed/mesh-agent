'use client'
import { useState, useEffect, useRef } from 'react'
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

interface ReviewIssue { title: string; severity: 'critical' | 'high' | 'medium' | 'low' }

const SEVERITY_STYLE: Record<string, { backgroundColor: string; color: string }> = {
  critical: { backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171' },
  high:     { backgroundColor: 'rgba(251,146,60,0.15)',  color: '#fb923c' },
  medium:   { backgroundColor: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
  low:      { backgroundColor: 'rgba(107,114,128,0.15)', color: '#9ca3af' },
}

function parseReviewIssues(commentBody: string): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  const summaryLine =
    commentBody.match(/\*\*สรุป:\*\*\s*(.+)/)?.[1] ??
    commentBody.match(/summary:\s*(.+)/i)?.[1] ?? ''

  const groups: Array<{ re: RegExp; severity: ReviewIssue['severity'] }> = [
    { re: /CRITICAL\s+\d+\s+จุด\s*\(([^)]+)\)/i, severity: 'critical' },
    { re: /HIGH\s+\d+\s+จุด\s*\(([^)]+)\)/i,     severity: 'high' },
    { re: /MEDIUM\s+\d+\s+จุด\s*\(([^)]+)\)/i,   severity: 'medium' },
    { re: /LOW\s+\d+\s+จุด\s*\(([^)]+)\)/i,      severity: 'low' },
  ]
  for (const { re, severity } of groups) {
    const m = summaryLine.match(re)
    if (m) m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(title => issues.push({ title, severity }))
  }

  // Fallback: **N. title** numbered items from outputLog excerpt
  if (issues.length === 0) {
    for (const m of commentBody.matchAll(/\*\*\d+\.\s*`?([^`*\n]{3,80})`?\*\*/g))
      issues.push({ title: m[1].trim(), severity: 'medium' })
  }

  return issues
}

const STAGE_COLORS: Record<string, string> = {
  backlog: '#6a7a8e',
  in_progress: '#f0883e',
  review: '#d2a8ff',
  done: '#3fb950',
}

/* ── Markdown renderer (no external deps) ── */
function renderInlineParts(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
  let last = 0; let m: RegExpExecArray | null; let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1]) parts.push(<strong key={k++} className="font-semibold text-text">{m[1]}</strong>)
    else if (m[2]) parts.push(<code key={k++} className="bg-black/20 text-green-400/70 font-mono text-[12px] px-1 py-0.5 rounded">{m[2]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderMarkdown(body: string): React.ReactNode {
  const segments = body.split(/(```[\s\S]*?```)/g)
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3).replace(/^\w*\n?/, '')
          return (
            <pre key={i} className="bg-black/30 text-green-400/80 font-mono text-[11px] p-3 rounded overflow-auto max-h-64 my-1.5 whitespace-pre-wrap break-all">
              {inner}
            </pre>
          )
        }
        return (
          <span key={i}>
            {seg.split('\n').map((line, j) =>
              line.trim() === ''
                ? <br key={j} />
                : <p key={j} className="text-[13px] text-text leading-relaxed my-0.5">{renderInlineParts(line)}</p>
            )}
          </span>
        )
      })}
    </>
  )
}

function filterNoise(output: string): string {
  return output
    .split('\n')
    .filter(line =>
      !line.startsWith('[warn] workingDir') &&
      !line.includes('SessionEnd hook') &&
      !line.includes('Cannot find module') &&
      !line.includes('requireStack')
    )
    .join('\n')
    .trim()
}

function SubtaskInlineOutput({ taskId, stage }: { taskId: string; stage: string }) {
  const [session, setSession] = useState<any>(null)
  const [liveOutput, setLiveOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    api.agents.sessionByTask(taskId).then(setSession).catch(() => {})
  }, [taskId])

  useEffect(() => {
    if (!session?.id || stage !== 'in_progress') return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await api.agents.sessionOutput(session.id)
        if (cancelled) return
        setLiveOutput(res.output)
        setIsRunning(res.running)
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
        if (res.running) setTimeout(poll, 2000)
        else api.agents.sessionByTask(taskId).then(setSession).catch(() => {})
      } catch {
        if (!cancelled) setTimeout(poll, 5000)
      }
    }
    poll()
    return () => { cancelled = true }
  }, [session?.id, stage, taskId])

  const displayOutput = liveOutput || session?.outputLog || ''

  return (
    <div className="border-t border-border px-3 pb-3 pt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        {isRunning && <span className="text-[#f0883e] animate-pulse font-medium">● live</span>}
        {!isRunning && session && <span className="text-dim">completed</span>}
        {session?.startedAt && <span className="text-dim">started {new Date(session.startedAt).toLocaleTimeString()}</span>}
        {session?.endedAt && <span className="text-dim">ended {new Date(session.endedAt).toLocaleTimeString()}</span>}
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
  )
}

interface TaskDetailPanelProps {
  task: any
  allTasks: any[]
  onClose: () => void
  onUpdate: () => void
  onDelete: (id: string) => void
}

type Tab = 'overview' | 'comments' | 'subtasks' | 'activity' | 'attachments'

export function TaskDetailPanel({ task, allTasks, onClose, onUpdate, onDelete }: TaskDetailPanelProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [comments, setComments] = useState<any[]>([])
  const [activities, setActivities] = useState<any[]>([])
  const [commentText, setCommentText] = useState('')
  const [sending, setSending] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [fixTasksCreatedCount, setFixTasksCreatedCount] = useState(0)
  const [localTask, setLocalTask] = useState(task)
  const [descValue, setDescValue] = useState(task.description ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskRole, setSubtaskRole] = useState('')
  const [attachments, setAttachments] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [expandedSubtaskId, setExpandedSubtaskId] = useState<string | null>(null)
  const [fixCommentId, setFixCommentId] = useState<string | null>(null)
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([])
  const [selectedIssues, setSelectedIssues] = useState<Set<number>>(new Set())
  const [fixingIssues, setFixingIssues] = useState(false)
  const [starting, setStarting] = useState(false)
  const [executionMode, setExecutionMode] = useState<'cloud' | 'local'>('cloud')
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Lock body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Fetch comments on mount for overview AI section + comments tab
  useEffect(() => {
    api.tasks.comments(task.id).then(setComments).catch(() => {})
  }, [task.id, task.stage])

  useEffect(() => {
    if (tab === 'activity') {
      api.tasks.activities(task.id).then(setActivities).catch(() => {})
    }
    if (tab === 'comments') {
      api.tasks.comments(task.id).then(setComments).catch(() => {})
    }
    if (tab === 'attachments') {
      api.tasks.attachments(task.id).then(setAttachments).catch(() => {})
    }
  }, [tab, task.id])

  const subtasks = allTasks.filter((t: any) => t.parentTaskId === task.id)

  useEffect(() => {
    const running = subtasks.find((s: any) => s.stage === 'in_progress')
    if (running) {
      setTab('subtasks')
      setExpandedSubtaskId(running.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

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

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const { uploadUrl } = await api.tasks.createAttachment(task.id, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
      })
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
      const fresh = await api.tasks.attachments(task.id)
      setAttachments(fresh)
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload ไม่สำเร็จ')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function openFixPanel(commentId: string, issues: ReviewIssue[]) {
    setFixCommentId(commentId)
    setReviewIssues(issues)
    setSelectedIssues(new Set(issues.map((_, i) => i)))
  }

  function toggleIssue(idx: number) {
    setSelectedIssues(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  async function confirmFix() {
    if (selectedIssues.size === 0) return
    setFixingIssues(true)
    try {
      const selected = reviewIssues.filter((_, i) => selectedIssues.has(i))
      await api.tasks.fixIssues(task.id, selected)
      const createdCount = selectedIssues.size
      setFixCommentId(null)
      setSelectedIssues(new Set())
      setFixTasksCreatedCount(createdCount)
      setTab('subtasks')
      onUpdate()
    } catch {} finally {
      setFixingIssues(false)
    }
  }

  const leadComment = comments.find((c: any) => c.source === 'lead')
  let plan: any = null
  if (leadComment) {
    try { plan = JSON.parse(leadComment.body) } catch {}
  }

  async function handleStart() {
    setStarting(true)
    try {
      await api.tasks.start(task.id, { executionMode })
      setLocalTask((t: any) => ({ ...t, stage: 'in_progress' }))
      const fresh = await api.tasks.activities(task.id)
      setActivities(fresh)
    } catch (e: any) {
      alert(e.message ?? 'Start failed')
    } finally {
      setStarting(false)
    }
  }

  const TABS: Tab[] = ['overview', 'comments', 'subtasks', 'activity', 'attachments']
  const TAB_LABEL: Record<Tab, string> = {
    overview: 'Overview',
    comments: 'Comments',
    subtasks: 'Subtasks',
    activity: 'Activity',
    attachments: 'Files',
  }

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
          {localTask.stage === 'backlog' && !confirmDelete && (
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex bg-canvas border border-border rounded overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => setExecutionMode('cloud')}
                  className={`px-2.5 py-1 transition-colors ${executionMode === 'cloud' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}
                >
                  ☁ Cloud
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionMode('local')}
                  className={`px-2.5 py-1 border-l border-border transition-colors ${executionMode === 'local' ? 'bg-success/15 text-success' : 'text-muted hover:text-text'}`}
                >
                  💻 Local
                </button>
              </div>
              <button
                onClick={handleStart}
                disabled={starting}
                className="text-[12px] px-2.5 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                title="Let Lead analyze and dispatch agents"
              >
                {starting ? 'Starting…' : '▶ Start with Lead'}
              </button>
            </div>
          )}
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
              className={`text-[13px] px-4 py-2 border-b-2 transition-colors ${
                tab === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {TAB_LABEL[t]}
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

              {/* ── Task Complete ── */}
              {localTask.stage === 'done' && (() => {
                const allIssues: ReviewIssue[] = []
                comments
                  .filter((c: any) => c.source === 'agent')
                  .forEach((c: any) => {
                    parseReviewIssues(c.body).forEach(issue => allIssues.push(issue))
                  })
                const doneCount = subtasks.filter((s: any) => s.stage === 'done').length
                const totalCount = subtasks.length

                return (
                  <div className="border border-success/30 bg-success/5 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-success">✓</span>
                        <div className="text-[12px] text-success font-semibold uppercase tracking-wide">Task Complete</div>
                      </div>
                      {totalCount > 0 && (
                        <button
                          onClick={() => setTab('subtasks')}
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
                              <span className="text-[12px] text-success">✓ {fixTasksCreatedCount} fix task{fixTasksCreatedCount !== 1 ? 's' : ''} created</span>
                              <button
                                onClick={() => setTab('subtasks')}
                                className="text-[11px] text-accent hover:underline"
                              >
                                View →
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setFixCommentId('__overview__')
                                setReviewIssues(allIssues)
                                setSelectedIssues(new Set(allIssues.map((_, i) => i)))
                              }}
                              className="self-start mt-1 text-[12px] px-3 py-1.5 rounded border border-orange-400/30 text-orange-300 hover:bg-orange-400/10 transition-colors"
                            >
                              🔧 Create Fix Tasks ({allIssues.length})
                            </button>
                          )
                        ) : (
                          <div className="border border-orange-400/20 rounded-lg p-3 bg-orange-400/5">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-[12px] text-orange-300 font-semibold uppercase tracking-wide">เลือก Issues</div>
                              <button
                                onClick={() => setSelectedIssues(selectedIssues.size === allIssues.length ? new Set() : new Set(allIssues.map((_, i) => i)))}
                                className="text-[11px] text-dim hover:text-muted"
                              >
                                {selectedIssues.size === allIssues.length ? 'Deselect All' : 'Select All'}
                              </button>
                            </div>
                            <div className="flex flex-col gap-1.5 mb-3">
                              {allIssues.map((issue, idx) => (
                                <label key={idx} className="flex items-center gap-2 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={selectedIssues.has(idx)}
                                    onChange={() => toggleIssue(idx)}
                                    className="shrink-0"
                                  />
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0" style={SEVERITY_STYLE[issue.severity]}>
                                    {issue.severity}
                                  </span>
                                  <span className="text-[13px] text-text group-hover:text-white transition-colors">{issue.title}</span>
                                </label>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={confirmFix}
                                disabled={selectedIssues.size === 0 || fixingIssues}
                                className="bg-orange-400/15 hover:bg-orange-400/25 border border-orange-400/25 text-orange-300 text-[13px] px-3 py-1.5 rounded transition-all disabled:opacity-40"
                              >
                                {fixingIssues ? '…' : `✓ Create ${selectedIssues.size} Fix Task${selectedIssues.size !== 1 ? 's' : ''}`}
                              </button>
                              <button
                                onClick={() => { setFixCommentId(null); setSelectedIssues(new Set()) }}
                                className="text-muted text-[13px] hover:text-text"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : totalCount > 0 ? (
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] text-text/70">All {doneCount} subtasks completed</p>
                        <button
                          onClick={() => setTab('subtasks')}
                          className="text-[11px] text-accent hover:underline"
                        >
                          View →
                        </button>
                      </div>
                    ) : (
                      <p className="text-[13px] text-text/70">No issues detected.</p>
                    )}
                  </div>
                )
              })()}
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
                      : c.source === 'agent'
                      ? 'rounded border border-accent/20 bg-canvas/50 px-3 py-2'
                      : 'bg-surface-2 rounded border border-border px-3 py-2'
                  }
                >
                  {c.source === 'lead' && (
                    <div className="text-[11px] text-accent font-semibold mb-1 uppercase tracking-wide">Lead AI</div>
                  )}
                  {c.source === 'agent' && (() => {
                    const issues = parseReviewIssues(c.body)
                    return (
                      <>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[11px] text-accent font-medium">🤖 Agent Summary</div>
                          {issues.length > 0 && fixCommentId !== c.id && (
                            <button
                              onClick={() => openFixPanel(c.id, issues)}
                              className="text-[11px] px-2 py-0.5 rounded border border-orange-400/30 text-orange-300 hover:bg-orange-400/10 transition-colors"
                            >
                              🔧 Fix Issues ({issues.length})
                            </button>
                          )}
                        </div>
                        <div className="text-[13px] text-text">{renderMarkdown(c.body)}</div>
                        {issues.length > 0 && fixCommentId !== c.id && (
                          <button
                            onClick={() => openFixPanel(c.id, issues)}
                            className="mt-2 text-[11px] px-2 py-1 rounded border border-orange-400/30 text-orange-300 hover:bg-orange-400/10 transition-colors w-full"
                          >
                            🔧 Fix {issues.length} Issue{issues.length !== 1 ? 's' : ''} — เลือก &amp; สร้าง Task
                          </button>
                        )}
                        {fixCommentId === c.id && (
                          <div className="mt-3 border border-orange-400/20 rounded-lg p-3 bg-orange-400/5">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-[12px] text-orange-300 font-semibold uppercase tracking-wide">เลือก Issues ที่ต้องการแก้</div>
                              {issues.length > 1 && (
                                <button
                                  onClick={() => setSelectedIssues(selectedIssues.size === issues.length ? new Set() : new Set(issues.map((_, i) => i)))}
                                  className="text-[11px] text-dim hover:text-muted"
                                >
                                  {selectedIssues.size === issues.length ? 'Deselect All' : 'Select All'}
                                </button>
                              )}
                            </div>
                            <div className="flex flex-col gap-1.5 mb-3">
                              {issues.map((issue, idx) => (
                                <label key={idx} className="flex items-center gap-2 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={selectedIssues.has(idx)}
                                    onChange={() => toggleIssue(idx)}
                                    className="shrink-0"
                                  />
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0"
                                    style={SEVERITY_STYLE[issue.severity]}
                                  >
                                    {issue.severity}
                                  </span>
                                  <span className="text-[13px] text-text group-hover:text-white transition-colors">{issue.title}</span>
                                </label>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={confirmFix}
                                disabled={selectedIssues.size === 0 || fixingIssues}
                                className="bg-orange-400/15 hover:bg-orange-400/25 border border-orange-400/25 text-orange-300 text-[13px] px-3 py-1.5 rounded transition-all disabled:opacity-40"
                              >
                                {fixingIssues ? '…' : `✓ Create ${selectedIssues.size} Fix Task${selectedIssues.size !== 1 ? 's' : ''}`}
                              </button>
                              <button
                                onClick={() => { setFixCommentId(null); setSelectedIssues(new Set()) }}
                                className="text-muted text-[13px] hover:text-text"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )
                  })()}
                  {c.source === 'lead' && (() => {
                    let parsed: any = null
                    try { parsed = JSON.parse(c.body) } catch {}
                    if (!parsed) return <div className="text-[13px] text-text whitespace-pre-wrap">{c.body}</div>
                    const priorityStyle: Record<string, string> = {
                      urgent: 'bg-red-500/20 text-red-400',
                      high: 'bg-orange-500/20 text-orange-400',
                      medium: 'bg-yellow-500/20 text-yellow-400',
                      low: 'bg-gray-500/20 text-gray-400',
                    }
                    return (
                      <div className="flex flex-col gap-1">
                        {parsed.summary && (
                          <p className="text-[13px] text-text/80 italic mb-2">{parsed.summary}</p>
                        )}
                        {Array.isArray(parsed.subtasks) && parsed.subtasks.map((st: any, idx: number) => {
                          const role = ROLE_STYLE[st.agentRole ?? '']
                          return (
                            <div key={idx} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                              <span className="text-[13px] text-text flex-1">{st.title}</span>
                              {st.agentRole && role && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ backgroundColor: role.bg, color: role.text }}>{st.agentRole}</span>
                              )}
                              {st.priority && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${priorityStyle[st.priority] ?? 'bg-gray-500/20 text-gray-400'}`}>{st.priority}</span>
                              )}
                              {st.wave > 1 && (
                                <span className="text-[10px] text-dim shrink-0">W{st.wave}</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                  {c.source === 'user' && (
                    <div className="text-[13px] text-text whitespace-pre-wrap">{c.body}</div>
                  )}
                  {c.createdAt && (
                    <div className="text-[11px] text-dim mt-2">{new Date(c.createdAt).toLocaleString()}</div>
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
                const isRunning = st.stage === 'in_progress'
                const isExpanded = expandedSubtaskId === st.id
                return (
                  <div
                    key={st.id}
                    className="flex flex-col rounded border transition-colors overflow-hidden"
                    style={{
                      borderColor: isExpanded ? 'var(--color-border-hi)' : 'var(--color-border)',
                      backgroundColor: 'var(--color-surface-2)',
                    }}
                  >
                    {/* Row header */}
                    <div
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                      onClick={() => setExpandedSubtaskId(isExpanded ? null : st.id)}
                    >
                      {isRunning ? (
                        <span className="relative inline-flex w-2 h-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: '#f0883e' }} />
                          <span className="relative inline-flex w-2 h-2 rounded-full" style={{ backgroundColor: '#f0883e' }} />
                        </span>
                      ) : (
                        <span
                          className="text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0"
                          style={{ color: STAGE_COLORS[st.stage] ?? '#6a7a8e', backgroundColor: `${STAGE_COLORS[st.stage] ?? '#6a7a8e'}20` }}
                        >
                          {st.stage ?? 'backlog'}
                        </span>
                      )}
                      <span className="text-[13px] text-text flex-1">{st.title}</span>
                      {st.agentRole && role && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: role.bg, color: role.text }}>
                          {st.agentRole}
                        </span>
                      )}
                      <span className="text-dim text-[11px] shrink-0">{isExpanded ? '▲' : '▼'}</span>
                    </div>

                    {/* Inline output panel */}
                    {isExpanded && <SubtaskInlineOutput taskId={st.id} stage={st.stage} />}
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

          {/* ── Attachments ── */}
          {tab === 'attachments' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-muted uppercase tracking-wide">Files</span>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    onChange={handleUpload}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="text-[13px] bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent px-3 py-1.5 rounded transition-all disabled:opacity-50"
                  >
                    {uploading ? 'Uploading…' : '+ Upload file'}
                  </button>
                </div>
              </div>

              {uploadError && (
                <p className="text-danger text-[12px]">✕ {uploadError}</p>
              )}

              {attachments.length === 0 ? (
                <p className="text-[13px] text-dim py-4 text-center">ยังไม่มีไฟล์แนบ</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {attachments.map((a: any) => (
                    <div key={a.id} className="flex items-center gap-3 p-2.5 bg-canvas border border-border rounded-lg">
                      <span className="text-[18px] shrink-0">
                        {a.mimeType?.startsWith('image/') ? '🖼️'
                          : a.mimeType === 'application/pdf' ? '📄'
                          : '📎'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-text truncate">{a.fileName}</div>
                        <div className="text-[11px] text-dim">
                          {a.fileSize ? `${(a.fileSize / 1024).toFixed(1)} KB` : ''}
                          {a.mimeType ? ` · ${a.mimeType.split('/')[1]}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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

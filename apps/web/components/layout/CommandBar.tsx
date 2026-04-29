'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import { useChatStream } from '@/lib/ws'

const ROLE_DOT: Record<string, string> = {
  frontend: '#22d3ee',
  backend: '#60a5fa',
  mobile: '#c084fc',
  devops: '#4ade80',
  designer: '#f472b6',
  qa: '#fb923c',
  reviewer: '#f87171',
  lead: '#facc15',
}

type ProposalStatus = 'pending' | 'consumed' | 'cancelled' | 'expired'

interface ProposalView {
  id: string
  status: ProposalStatus
  taskBrief: { title: string; description: string }
  roles: { slug: string; reason?: string }[]
  waves?: { roles: { slug: string; reason?: string }[]; brief: string }[]
  projectId: string | null
  baseBranch: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'lead' | 'agent' | 'system'
  content: string
  timestamp: number
  imageRefs?: string[]
  meta?: {
    agentRole?: string
    sessionId?: string
    taskId?: string
    intent?: 'chat' | 'clarify' | 'dispatch'
    proposal?: ProposalView
    questions?: string[]
    confirmed?: boolean
    topicReset?: boolean
  }
}

interface Attachment {
  id: string
  name: string
  mimeType: string
  data: string // base64
  preview: string // data URL
}

interface TextFile {
  id: string
  name: string
  ext: string
  content: string
}

const MAX_ATTACHMENTS = 4
const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4MB per image
const MAX_TEXT_FILES = 4
const MAX_TEXT_BYTES = 50 * 1024 // 50KB per text file
const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md', '.py', '.go', '.rs',
  '.sh', '.yaml', '.yml', '.toml', '.env', '.txt', '.css', '.html', '.sql',
  '.xml', '.graphql', '.prisma', '.csv',
])

function readAsBase64(file: File): Promise<{ data: string; preview: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // result is data:<mime>;base64,<payload>
      const base64 = result.split(',')[1] ?? ''
      resolve({ data: base64, preview: result })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export function CommandBar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [textFiles, setTextFiles] = useState<TextFile[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [unread, setUnread] = useState(0)
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)
  const [leadThinking, setLeadThinking] = useState(false)
  const [stoppedSessions, setStoppedSessions] = useState<Set<string>>(new Set())
  const [executionMode, setExecutionMode] = useState<'cloud' | 'local'>('cloud')
  const [companionConnected, setCompanionConnected] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  openRef.current = open

  const loadHistory = useCallback(async () => {
    try {
      const [list, projectList] = await Promise.all([
        api.chat.history(),
        api.projects.list(),
      ])
      setHistory(list)
      setProjects(projectList)
      if (!selectedProjectId && projectList.length > 0) {
        setSelectedProjectId(projectList[0].id)
      }
    } catch {
      /* ignore */
    }
  }, [selectedProjectId])

  useEffect(() => {
    if (open) {
      loadHistory()
      setUnread(0)
    }
  }, [open, loadHistory])

  // Real-time push from server-side chat events
  const handleStream = useCallback((msg: ChatMessage) => {
    setHistory((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      return [...prev, msg]
    })
    if (!openRef.current && msg.role !== 'user') {
      setUnread((u) => u + 1)
    }
  }, [])
  const handleProposalUpdate = useCallback((proposalId: string, status: string) => {
    setHistory((prev) =>
      prev.map((m) => {
        if (m.meta?.proposal?.id !== proposalId) return m
        return {
          ...m,
          meta: {
            ...m.meta,
            proposal: { ...m.meta.proposal, status: status as ProposalStatus },
          },
        }
      }),
    )
  }, [])
  const handleLeadStatus = useCallback((status: 'thinking' | 'idle') => {
    setLeadThinking(status === 'thinking')
  }, [])
  const handleReconnect = useCallback(() => {
    // Catch up on anything we missed during the disconnect
    api.chat.history().then(setHistory).catch(() => {})
  }, [])
  useChatStream({
    onMessage: handleStream,
    onProposalUpdate: handleProposalUpdate,
    onLeadStatus: handleLeadStatus,
    onReconnect: handleReconnect,
  })

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 30)
    return () => clearTimeout(t)
  }, [history, open, leadThinking])

  useEffect(() => {
    const check = () =>
      api.companion.status()
        .then(s => setCompanionConnected(s.connected))
        .catch(() => setCompanionConnected(false))
    check()
    const t = setInterval(check, 10_000)
    return () => clearInterval(t)
  }, [])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError('')
    const nextAttachments: Attachment[] = []
    const nextTextFiles: TextFile[] = []
    for (const f of Array.from(files)) {
      const ext = '.' + f.name.split('.').pop()!.toLowerCase()
      const isImage = f.type.startsWith('image/')
      const isPdf = f.type === 'application/pdf'
      const isText = TEXT_EXTS.has(ext) || f.type.startsWith('text/')

      if (isImage || isPdf) {
        if (attachments.length + nextAttachments.length >= MAX_ATTACHMENTS) continue
        if (f.size > MAX_FILE_BYTES) { setError(`${f.name}: ใหญ่เกิน 4MB`); continue }
        try {
          const { data, preview } = await readAsBase64(f)
          nextAttachments.push({ id: `${Date.now()}-${f.name}`, name: f.name, mimeType: f.type, data, preview })
        } catch { setError(`${f.name}: อ่านไฟล์ไม่ได้`) }
      } else if (isText) {
        if (textFiles.length + nextTextFiles.length >= MAX_TEXT_FILES) continue
        if (f.size > MAX_TEXT_BYTES) { setError(`${f.name}: ใหญ่เกิน 50KB`); continue }
        try {
          const content = await readAsText(f)
          nextTextFiles.push({ id: `${Date.now()}-${f.name}`, name: f.name, ext, content })
        } catch { setError(`${f.name}: อ่านไฟล์ไม่ได้`) }
      } else {
        setError(`${f.name}: ไม่รองรับประเภทไฟล์นี้`)
      }
    }
    if (nextAttachments.length > 0) setAttachments((prev) => [...prev, ...nextAttachments])
    if (nextTextFiles.length > 0) setTextFiles((prev) => [...prev, ...nextTextFiles])
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  async function send() {
    if (!message.trim() && attachments.length === 0 && textFiles.length === 0) return
    setSending(true)
    setError('')
    const fileBlocks = textFiles.map((f) => {
      const lang = f.ext.replace('.', '')
      return `\`\`\`${lang}\n// ${f.name}\n${f.content}\n\`\`\``
    })
    const fullMessage = fileBlocks.length > 0
      ? fileBlocks.join('\n\n') + (message.trim() ? '\n\n' + message.trim() : '')
      : (message.trim() || '(แนบไฟล์อย่างเดียว)')
    const payload = {
      message: fullMessage,
      images: attachments.map((a) => ({
        name: a.name,
        mimeType: a.mimeType,
        data: a.data,
      })),
      projectId: selectedProjectId || undefined,
      executionMode,
    }
    try {
      await api.chat.send(payload)
      setMessage('')
      setAttachments([])
      setTextFiles([])
    } catch (e: any) {
      setError(e.message ?? 'ส่งไม่สำเร็จ')
    } finally {
      setSending(false)
    }
  }

  async function sendQuickReply(text: string) {
    if (sending) return
    setSending(true)
    setError('')
    try {
      await api.chat.send({ message: text, projectId: selectedProjectId || undefined, executionMode })
    } catch (e: any) {
      setError(e.message ?? 'ส่งไม่สำเร็จ')
    } finally {
      setSending(false)
    }
  }

  async function clearHistory() {
    if (!confirm('ล้างประวัติแชท?')) return
    await api.chat.clear()
    setHistory([])
  }

  async function startNewTopic() {
    try {
      await api.chat.newTopic()
      // server publishes the marker via WS; no manual append needed
    } catch (e: any) {
      setError(e?.message ?? 'เริ่มหัวข้อใหม่ไม่สำเร็จ')
    }
  }

  function applyProposalStatus(id: string, status: ProposalStatus) {
    setHistory((prev) =>
      prev.map((m) => {
        if (m.meta?.proposal?.id !== id) return m
        return {
          ...m,
          meta: { ...m.meta, proposal: { ...m.meta.proposal, status } },
        }
      }),
    )
  }

  async function confirmProposal(id: string) {
    setBusyProposalId(id)
    setError('')
    try {
      await api.chat.dispatch(id)
      // server pushes proposal-update via WS; optimistic mark just in case
      applyProposalStatus(id, 'consumed')
    } catch (e: any) {
      if (e instanceof ApiError) {
        const serverStatus = e.body?.status as ProposalStatus | undefined
        if (e.status === 410) {
          applyProposalStatus(id, 'expired')
        } else if (e.status === 409 && serverStatus) {
          applyProposalStatus(id, serverStatus)
        } else {
          setError(e.message || 'ยืนยันไม่สำเร็จ')
        }
      } else {
        setError(e?.message ?? 'ยืนยันไม่สำเร็จ')
      }
    } finally {
      setBusyProposalId(null)
    }
  }

  async function cancelProposal(id: string) {
    setBusyProposalId(id)
    setError('')
    try {
      await api.chat.cancelProposal(id)
      applyProposalStatus(id, 'cancelled')
    } catch (e: any) {
      setError(e.message ?? 'ยกเลิกไม่สำเร็จ')
    } finally {
      setBusyProposalId(null)
    }
  }

  if (pathname === '/login') return null

  return (
    <>
      {/* Floating launcher (collapsed) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-30 flex items-center gap-2 px-4 py-2.5 rounded-full font-semibold transition-all duration-200 bg-[#0d1117]/90 backdrop-blur-sm border border-[#facc15]/30 text-[#facc15] hover:border-[#facc15]/60 hover:shadow-[0_0_24px_rgba(250,204,21,0.25)] shadow-[0_0_12px_rgba(250,204,21,0.12),0_4px_16px_rgba(0,0,0,0.4)]"
          title="เปิดแชทกับ Lead"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Lead</span>
          {unread > 0 && (
            <span className="bg-[#facc15] text-[#0d1117] text-[11px] font-bold rounded-full px-1.5 min-w-[18px] text-center leading-5">
              {unread}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed inset-x-3 bottom-3 lg:left-auto lg:right-5 lg:bottom-5 lg:w-[440px] z-30 bg-surface border border-border-hi rounded-xl shadow-2xl flex flex-col fade-up max-h-[calc(100vh-1.5rem)] glow-border">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: ROLE_DOT.lead }}
              />
              <div>
                <div className="text-[14px] font-semibold text-text">Lead</div>
                <div className="text-[11px] text-muted">สั่งงาน · วิเคราะห์ · Dispatch agents</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={startNewTopic}
                className="text-muted hover:text-accent text-[12px] px-2 py-1 transition-colors"
                title="เริ่มหัวข้อใหม่ — Lead จะลืมบทสนทนาก่อนหน้าเวลาวิเคราะห์ข้อความถัดไป"
              >
                หัวข้อใหม่
              </button>
              <button
                onClick={clearHistory}
                className="text-muted hover:text-text text-[12px] px-2 py-1 transition-colors"
                title="ล้างประวัติ"
              >
                ล้าง
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-muted hover:text-text text-[14px] px-2 py-1 transition-colors"
                title="ปิด"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 min-h-[280px]"
            style={{ maxHeight: 'calc(70vh - 200px)' }}
          >
            {history.length === 0 ? (
              <div className="flex flex-col gap-2 px-1 pb-1 pt-1">
                <p className="text-[12px] text-muted px-3">ลองพิมพ์:</p>
                {[
                  'อธิบายโครงสร้าง auth ในระบบให้ฟังหน่อย',
                  'อยากเพิ่ม feature dark mode เริ่มจากไหนดี',
                  'มี bug ตรงปุ่ม logout — ช่วยวิเคราะห์ที',
                  'setup CI/CD pipeline ได้เลย',
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setMessage(s)}
                    className="text-left text-[12px] text-accent hover:text-text bg-canvas border border-border hover:border-border-hi px-3 py-2 rounded-lg transition-all truncate"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              history.map((m) => {
                if (m.meta?.topicReset || m.role === 'system') {
                  return <TopicDivider key={m.id} label={m.content} />
                }
                return (
                  <ChatBubble
                    key={m.id}
                    m={m}
                    busy={
                      m.meta?.proposal ? busyProposalId === m.meta.proposal.id : false
                    }
                    onConfirm={confirmProposal}
                    onCancel={cancelProposal}
                    stoppedSessions={stoppedSessions}
                    onStop={(sid) => {
                      api.agents.stop(sid).catch(() => {})
                      setStoppedSessions((prev) => new Set([...prev, sid]))
                    }}
                    onQuickReply={sendQuickReply}
                    replying={sending}
                  />
                )
              })
            )}
            {leadThinking && <LeadThinkingBubble />}
          </div>

          {/* Project selector */}
          {projects.length > 0 && (
            <div className="px-3 pt-2 pb-0 border-t border-border flex items-center gap-2">
              <span className="text-[11px] text-dim shrink-0">Project:</span>
              <select
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                className="flex-1 bg-canvas border border-border text-text text-[12px] rounded px-2 py-1 focus:border-accent/60 min-w-0"
              >
                <option value="">— ไม่ระบุ —</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Attachments preview */}
          {(attachments.length > 0 || textFiles.length > 0) && (
            <div className="px-3 py-2 border-t border-border flex flex-wrap gap-2">
              {attachments.map((a) => (
                <div key={a.id} className="relative shrink-0">
                  {a.mimeType === 'application/pdf' ? (
                    <div className="h-14 flex items-center gap-1.5 bg-canvas border border-border rounded px-2.5 text-[12px] text-muted max-w-[140px]">
                      <span>📄</span>
                      <span className="truncate">{a.name}</span>
                    </div>
                  ) : (
                    <img
                      src={a.preview}
                      alt={a.name}
                      className="w-14 h-14 object-cover rounded border border-border"
                    />
                  )}
                  <button
                    onClick={() => removeAttachment(a.id)}
                    className="absolute -top-1 -right-1 bg-canvas border border-border rounded-full w-5 h-5 flex items-center justify-center text-[11px] text-muted hover:text-danger"
                    title="ลบ"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {textFiles.map((f) => (
                <div key={f.id} className="relative shrink-0">
                  <div className="h-14 flex items-center gap-1.5 bg-canvas border border-border rounded px-2.5 text-[12px] text-muted max-w-[160px]">
                    <span>📝</span>
                    <div className="min-w-0">
                      <div className="truncate text-text">{f.name}</div>
                      <div className="text-dim">{f.content.split('\n').length} lines</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setTextFiles((prev) => prev.filter((t) => t.id !== f.id))}
                    className="absolute -top-1 -right-1 bg-canvas border border-border rounded-full w-5 h-5 flex items-center justify-center text-[11px] text-muted hover:text-danger"
                    title="ลบ"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-danger text-[12px] px-4 pb-1">✕ {error}</p>
          )}

          {/* Composer */}
          <div className="px-3 pt-3 pb-1 border-t border-border flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.ts,.tsx,.js,.jsx,.mjs,.json,.md,.txt,.py,.go,.rs,.sh,.yaml,.yml,.toml,.env,.css,.html,.sql,.xml,.graphql,.prisma,.csv"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= MAX_ATTACHMENTS && textFiles.length >= MAX_TEXT_FILES}
              className="text-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-2"
              title="แนบไฟล์ — รูป, PDF, โค้ด"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14.5 7.5l-7.42 7.42a4.5 4.5 0 0 1-6.36-6.36L7.5 1.78a3 3 0 1 1 4.24 4.24l-6.78 6.78a1.5 1.5 0 1 1-2.12-2.12L8.7 5.6"
                  fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <div className="flex items-center gap-0.5 rounded-lg bg-canvas border border-border p-0.5 shrink-0 self-end mb-0.5">
              <button
                type="button"
                onClick={() => setExecutionMode('cloud')}
                title="Cloud execution"
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  executionMode === 'cloud' ? 'bg-accent/20 text-accent' : 'text-dim hover:text-muted'
                }`}
              >
                ☁ Cloud
              </button>
              <button
                type="button"
                onClick={() => setExecutionMode('local')}
                disabled={!companionConnected}
                title={companionConnected ? 'Local execution' : 'Companion not connected'}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  executionMode === 'local' ? 'bg-accent/20 text-accent' : 'text-dim hover:text-muted'
                }`}
              >
                💻 Local
              </button>
            </div>
            <textarea
              placeholder="พิมพ์คำสั่งให้ Lead… (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              onPaste={async (e) => {
                const items = Array.from(e.clipboardData?.items ?? [])
                const imageItems = items.filter((i) => i.type.startsWith('image/'))
                if (imageItems.length === 0) return
                e.preventDefault()
                setError('')
                for (const item of imageItems) {
                  if (attachments.length >= MAX_ATTACHMENTS) {
                    setError(`แนบรูปได้สูงสุด ${MAX_ATTACHMENTS} ไฟล์`)
                    break
                  }
                  const file = item.getAsFile()
                  if (!file) continue
                  if (file.size > MAX_FILE_BYTES) {
                    setError('รูปที่ paste ใหญ่เกิน 4MB')
                    continue
                  }
                  try {
                    const { data, preview } = await readAsBase64(file)
                    setAttachments((prev) => [
                      ...prev,
                      {
                        id: `paste-${Date.now()}`,
                        name: `paste-${Date.now()}.png`,
                        mimeType: file.type || 'image/png',
                        data,
                        preview,
                      },
                    ])
                  } catch {
                    setError('paste รูปไม่สำเร็จ')
                  }
                }
              }}
              rows={3}
              className="flex-1 bg-canvas border border-border rounded px-3 py-2.5 text-[14px] text-text placeholder-dim resize-none focus:border-accent/60 max-h-48"
              style={{ minHeight: 80 }}
            />
            <button
              onClick={send}
              disabled={sending || (!message.trim() && attachments.length === 0 && textFiles.length === 0)}
              className="bg-accent/90 hover:bg-accent text-canvas text-[13px] font-semibold px-3 py-2 rounded transition-colors disabled:opacity-40 shrink-0"
            >
              {sending ? '…' : 'ส่ง'}
            </button>
          </div>
          <p className="text-[11px] text-dim text-center pb-2">
            Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ · วางรูปได้เลย
          </p>
        </div>
      )}
    </>
  )
}

interface ChatBubbleProps {
  m: ChatMessage
  busy: boolean
  onConfirm: (proposalId: string) => void
  onCancel: (proposalId: string) => void
  stoppedSessions: Set<string>
  onStop: (sessionId: string) => void
  onQuickReply: (text: string) => void
  replying: boolean
}

function TopicDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-1 select-none" role="separator">
      <span className="flex-1 h-px bg-border" />
      <span className="text-[10.5px] text-dim uppercase tracking-wider whitespace-nowrap">
        {label}
      </span>
      <span className="flex-1 h-px bg-border" />
    </div>
  )
}

function LeadThinkingBubble() {
  return (
    <div className="flex justify-start gap-2" aria-live="polite">
      <span
        className="w-2 h-2 rounded-full mt-2 shrink-0 animate-pulse"
        style={{ backgroundColor: ROLE_DOT.lead }}
      />
      <div>
        <div className="text-[11px] text-muted mb-0.5 font-medium uppercase tracking-wider">
          Lead
        </div>
        <div className="bg-surface-2 border border-border text-text rounded-2xl rounded-bl-sm px-3 py-2 inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted/70 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-muted/70 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-muted/70 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

function getQuickChips(content: string): string[] {
  const t = content.toLowerCase()
  if (/approve|permission|อนุมัติ|allow/.test(t))
    return ['ใช่ approve เลย', 'ยังก่อน', 'ขอดูก่อน']
  if (/dispatch|ส่ง agent|ให้.*ทำ|frontend|backend|mobile|devops|designer|qa|reviewer/.test(t))
    return ['ใช่ ส่งเลย', 'ยังก่อน', 'ปรับ scope ก่อน']
  if (/review|pr|pull request|merge/.test(t))
    return ['ให้ review เลย', 'ยังก่อน', 'ขอแก้ก่อน']
  if (/deploy|release|push|production/.test(t))
    return ['ใช่ deploy เลย', 'ยังก่อน', 'ขอเช็คก่อน']
  if (/test|qa|spec/.test(t))
    return ['รัน test เลย', 'ยังก่อน', 'บอกรายละเอียดเพิ่ม']
  return ['ใช่ ดำเนินการเลย', 'ยังก่อน', 'บอกรายละเอียดเพิ่ม']
}

function ChatBubble({ m, busy, onConfirm, onCancel, stoppedSessions, onStop, onQuickReply, replying }: ChatBubbleProps) {
  const isUser = m.role === 'user'
  const isLead = m.role === 'lead'
  const role = m.meta?.agentRole
  const isLeadQuestion =
    isLead &&
    !m.meta?.proposal &&
    /[?？]|ไหม\s*[?]?\s*$/.test(m.content.trim())

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-accent/15 border border-accent/25 text-text rounded-2xl rounded-br-sm px-3 py-2">
          {m.content && (
            <p className="text-[13.5px] whitespace-pre-wrap leading-relaxed">{m.content}</p>
          )}
          {m.imageRefs && m.imageRefs.length > 0 && (
            <p className="text-[11px] text-muted mt-1">📎 {m.imageRefs.join(', ')}</p>
          )}
        </div>
      </div>
    )
  }

  const proposal = m.meta?.proposal
  const questions = m.meta?.questions

  return (
    <div className="flex justify-start gap-2">
      <span
        className="w-2 h-2 rounded-full mt-2 shrink-0"
        style={{
          backgroundColor: isLead
            ? ROLE_DOT.lead
            : (role && ROLE_DOT[role]) || '#6a7a8e',
        }}
      />
      <div className="max-w-[85%] flex-1 min-w-0">
        <div className="text-[11px] text-muted mb-0.5 font-medium uppercase tracking-wider">
          {isLead ? 'Lead' : role ?? 'Agent'}
        </div>
        <div className="bg-surface-2 border border-border text-text rounded-2xl rounded-bl-sm px-3 py-2">
          <p className="text-[13.5px] whitespace-pre-wrap leading-relaxed">{m.content}</p>
          {questions && questions.length > 0 && (
            <ul className="mt-2 pl-4 list-disc text-[12.5px] text-muted space-y-0.5">
              {questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          {m.role === 'agent' && m.content.includes('PR: https://') && (
            <a
              href={m.content.match(/PR: (https:\/\/[^\s]+)/)?.[1]}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent underline mt-1 block"
            >
              → ดู Pull Request
            </a>
          )}
          {m.role === 'agent' && m.meta?.sessionId && !stoppedSessions.has(m.meta.sessionId) && m.content.includes('เริ่มทำงานแล้ว') && (
            <button
              onClick={() => onStop(m.meta!.sessionId!)}
              className="mt-1.5 text-[11px] text-danger/70 hover:text-danger border border-danger/20 hover:border-danger/50 px-2 py-0.5 rounded transition-colors"
            >
              ■ หยุดงาน
            </button>
          )}
          {m.role === 'agent' && m.meta?.taskId && (m.content.includes('เสร็จแล้ว') || m.content.includes('✓')) && (
            <a
              href="/kanban"
              className="mt-1.5 text-[11px] text-muted hover:text-accent border border-border hover:border-accent/40 px-2 py-0.5 rounded transition-colors inline-block"
            >
              ดู Task ใน Kanban →
            </a>
          )}
        </div>
        {isLeadQuestion && (
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {getQuickChips(m.content).map((reply) => (
              <button
                key={reply}
                onClick={() => onQuickReply(reply)}
                disabled={replying}
                className="text-[12px] px-2.5 py-1 rounded-full border border-border hover:border-accent/50 text-muted hover:text-text bg-canvas transition-all disabled:opacity-40"
              >
                {reply}
              </button>
            ))}
          </div>
        )}
        {proposal && (
          <ProposalCard
            proposal={proposal}
            busy={busy}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>
  )
}

interface ProposalCardProps {
  proposal: ProposalView
  busy: boolean
  onConfirm: (proposalId: string) => void
  onCancel: (proposalId: string) => void
}

const STATUS_BADGE: Record<
  ProposalStatus,
  { label: string; tone: 'info' | 'success' | 'muted' | 'warn' }
> = {
  pending: { label: 'รอยืนยัน', tone: 'info' },
  consumed: { label: '✓ สั่งงานแล้ว', tone: 'success' },
  cancelled: { label: '✕ ยกเลิกแล้ว', tone: 'muted' },
  expired: { label: '⏱ หมดอายุ', tone: 'warn' },
}

function ProposalCard({ proposal, busy, onConfirm, onCancel }: ProposalCardProps) {
  const status = proposal.status ?? 'pending'
  const isPending = status === 'pending'
  const isResolved = !isPending
  const badge = STATUS_BADGE[status]
  const toneClass =
    badge.tone === 'success'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
      : badge.tone === 'warn'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      : badge.tone === 'info'
      ? 'bg-accent/10 text-accent border-accent/30'
      : 'bg-surface-2 text-dim border-border'

  return (
    <div
      className={`mt-2 bg-canvas border rounded-lg p-3 text-[12.5px] flex flex-col gap-2 transition-opacity ${
        isResolved ? 'border-border opacity-70' : 'border-border-hi'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-dim uppercase tracking-wider mb-0.5">Proposed task</div>
          <div className="text-text font-semibold leading-snug">{proposal.taskBrief.title}</div>
        </div>
        <span
          className={`shrink-0 inline-flex items-center text-[10.5px] font-medium uppercase tracking-wider border rounded-full px-2 py-0.5 ${toneClass}`}
        >
          {badge.label}
        </span>
      </div>
      <p className="text-muted whitespace-pre-wrap leading-relaxed">
        {proposal.taskBrief.description}
      </p>
      {proposal.waves && proposal.waves.length > 1 ? (
        <div className="flex flex-col gap-1.5 mt-2">
          {proposal.waves.map((wave, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[11px] text-dim w-14 shrink-0 pt-0.5">Wave {i + 1}</span>
              <div className="flex flex-col gap-0.5">
                <div className="flex gap-1 flex-wrap">
                  {wave.roles.map((r) => (
                    <span
                      key={r.slug}
                      className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                      style={{
                        backgroundColor: `${ROLE_DOT[r.slug] ?? '#888'}22`,
                        color: ROLE_DOT[r.slug] ?? '#888',
                      }}
                    >
                      {r.slug}
                    </span>
                  ))}
                </div>
                {wave.brief && (
                  <span className="text-[11px] text-dim">{wave.brief}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-1 flex-wrap mt-1">
          {proposal.roles.map((r) => (
            <span
              key={r.slug}
              className="px-1.5 py-0.5 rounded text-[12px] font-medium"
              style={{
                backgroundColor: `${ROLE_DOT[r.slug] ?? '#888'}22`,
                color: ROLE_DOT[r.slug] ?? '#888',
              }}
            >
              {r.slug}
            </span>
          ))}
        </div>
      )}
      {isPending && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onConfirm(proposal.id)}
            disabled={busy}
            className="bg-accent/90 hover:bg-accent text-canvas text-[12px] font-semibold px-3 py-1.5 rounded transition-colors disabled:opacity-40"
          >
            {busy ? '…' : 'ยืนยันและสั่งงาน'}
          </button>
          <button
            onClick={() => onCancel(proposal.id)}
            disabled={busy}
            className="text-muted hover:text-danger text-[12px] px-2 py-1.5 transition-colors disabled:opacity-40"
          >
            ยกเลิก
          </button>
        </div>
      )}
    </div>
  )
}

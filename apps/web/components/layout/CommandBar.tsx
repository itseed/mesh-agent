'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
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

interface ChatMessage {
  id: string
  role: 'user' | 'lead' | 'agent'
  content: string
  timestamp: number
  imageRefs?: string[]
  meta?: { agentRole?: string; sessionId?: string; taskId?: string }
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
  useChatStream(handleStream)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 30)
    return () => clearTimeout(t)
  }, [history, open])

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

  async function clearHistory() {
    if (!confirm('ล้างประวัติแชท?')) return
    await api.chat.clear()
    setHistory([])
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
                  'วิเคราะห์งานใน backlog และเสนอแผน',
                  'สร้าง task: setup CI/CD pipeline',
                  'รายงานสถานะทุก agent ที่รันอยู่',
                  'dispatch frontend agent ไปทำ task ล่าสุด',
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
              history.map((m) => <ChatBubble key={m.id} m={m} />)
            )}
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

function ChatBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === 'user'
  const isLead = m.role === 'lead'
  const role = m.meta?.agentRole

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
      <div className="max-w-[85%]">
        <div className="text-[11px] text-muted mb-0.5 font-medium uppercase tracking-wider">
          {isLead ? 'Lead' : role ?? 'agent'}
        </div>
        <div className="bg-surface-2 border border-border text-text rounded-2xl rounded-bl-sm px-3 py-2">
          <p className="text-[13.5px] whitespace-pre-wrap leading-relaxed">{m.content}</p>
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
        </div>
      </div>
    </div>
  )
}

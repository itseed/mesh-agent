'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

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

const MAX_ATTACHMENTS = 4
const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4MB per image

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

export function CommandBar() {
  const pathname = usePathname()
  const { token } = useAuth()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [unread, setUnread] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadHistory = useCallback(async () => {
    if (!token) return
    try {
      const list = await api.chat.history(token)
      setHistory(list)
    } catch {
      /* ignore */
    }
  }, [token])

  useEffect(() => {
    if (open) {
      loadHistory()
      setUnread(0)
    }
  }, [open, loadHistory])

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
    const remaining = MAX_ATTACHMENTS - attachments.length
    const list = Array.from(files).slice(0, remaining)
    const next: Attachment[] = []
    for (const f of list) {
      if (!f.type.startsWith('image/')) {
        setError(`${f.name}: รองรับเฉพาะรูปภาพ`)
        continue
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`${f.name}: ใหญ่เกิน 4MB`)
        continue
      }
      try {
        const { data, preview } = await readAsBase64(f)
        next.push({
          id: `${Date.now()}-${f.name}`,
          name: f.name,
          mimeType: f.type,
          data,
          preview,
        })
      } catch {
        setError(`${f.name}: อ่านไฟล์ไม่ได้`)
      }
    }
    setAttachments((prev) => [...prev, ...next])
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  async function send() {
    if (!token || (!message.trim() && attachments.length === 0)) return
    setSending(true)
    setError('')
    const payload = {
      message: message.trim() || '(แนบรูปอย่างเดียว)',
      images: attachments.map((a) => ({
        name: a.name,
        mimeType: a.mimeType,
        data: a.data,
      })),
    }
    try {
      const res = await api.chat.send(token, payload)
      setMessage('')
      setAttachments([])
      setHistory((prev) => [...prev, res.user, res.lead, ...res.dispatches])
    } catch (e: any) {
      setError(e.message ?? 'ส่งไม่สำเร็จ')
    } finally {
      setSending(false)
    }
  }

  async function clearHistory() {
    if (!token) return
    if (!confirm('ล้างประวัติแชท?')) return
    await api.chat.clear(token)
    setHistory([])
  }

  if (pathname === '/login') return null

  return (
    <>
      {/* Floating launcher (collapsed) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-30 bg-accent/90 hover:bg-accent text-canvas font-semibold rounded-full shadow-lg flex items-center gap-2 px-4 py-2.5 transition-colors"
          title="เปิดแชทกับ Lead"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2 12 12 0 0 0 1.927-.587c.16-.066.338-.077.512-.012A8 8 0 0 0 8 14.5c4.18 0 7-2.782 7-6.187C15 4.91 12.18 2.125 8 2.125c-4.179 0-7 2.785-7 6.188 0 1.297.49 2.503 1.355 3.504a1 1 0 0 1 .323.077z" />
          </svg>
          <span>คุยกับ Lead</span>
          {unread > 0 && (
            <span className="bg-canvas text-accent text-[12px] font-bold rounded-full px-1.5 min-w-[20px] text-center">
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
                <div className="text-[11px] text-muted">กระจายงานให้ทีม agent</div>
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
              <div className="flex-1 flex items-center justify-center text-center px-6">
                <div>
                  <div className="text-muted text-[13px] mb-1">
                    บอก Lead ว่าต้องการอะไร
                  </div>
                  <div className="text-dim text-[12px]">
                    Lead จะวิเคราะห์และกระจายงานให้ frontend / backend / qa ฯลฯ
                  </div>
                </div>
              </div>
            ) : (
              history.map((m) => <ChatBubble key={m.id} m={m} />)
            )}
          </div>

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="px-3 py-2 border-t border-border flex gap-2 overflow-x-auto">
              {attachments.map((a) => (
                <div key={a.id} className="relative shrink-0">
                  <img
                    src={a.preview}
                    alt={a.name}
                    className="w-14 h-14 object-cover rounded border border-border"
                  />
                  <button
                    onClick={() => removeAttachment(a.id)}
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
          <div className="px-3 py-3 border-t border-border flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= MAX_ATTACHMENTS}
              className="text-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-2"
              title={`แนบรูป (สูงสุด ${MAX_ATTACHMENTS} ไฟล์)`}
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
              rows={1}
              className="flex-1 bg-canvas border border-border rounded px-3 py-2 text-[14px] text-text placeholder-dim resize-none focus:border-accent/60 max-h-32"
              style={{ minHeight: 38 }}
            />
            <button
              onClick={send}
              disabled={sending || (!message.trim() && attachments.length === 0)}
              className="bg-accent/90 hover:bg-accent text-canvas text-[13px] font-semibold px-3 py-2 rounded transition-colors disabled:opacity-40 shrink-0"
            >
              {sending ? '…' : 'ส่ง'}
            </button>
          </div>
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
        </div>
      </div>
    </div>
  )
}

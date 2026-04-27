'use client'
import { useEffect, useRef, useState } from 'react'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001'
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Reconnects with exponential backoff up to 30s. Calls onOpen each time the
// connection comes up so callers can resync any state they may have missed.
function connectWithReconnect(
  url: string,
  handlers: {
    onMessage: (data: unknown) => void
    onOpen?: (isReconnect: boolean) => void
  },
): () => void {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let stopped = false
  let opened = false

  const connect = () => {
    if (stopped) return
    ws = new WebSocket(url)
    ws.onopen = () => {
      const isReconnect = attempt > 0
      attempt = 0
      opened = true
      handlers.onOpen?.(isReconnect)
    }
    ws.onmessage = (event) => {
      try {
        handlers.onMessage(JSON.parse(event.data))
      } catch {
        /* ignore malformed payload */
      }
    }
    ws.onclose = () => {
      ws = null
      if (stopped) return
      attempt += 1
      // 1s, 2s, 4s, … capped at 30s. Reset to 0 on next successful open.
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5))
      reconnectTimer = setTimeout(connect, delay)
    }
    ws.onerror = () => {
      // close handler will run; nothing to do here besides letting it
    }
  }

  connect()

  return () => {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws) {
      // Only close cleanly if it opened — closing a CONNECTING socket throws in some browsers.
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    void opened
  }
}

export interface AgentOutputEvent {
  channel?: string
  type?: string
  line?: string
  status?: string
  metrics?: { durationMs: number | null; outputBytes: number; success: boolean }
  raw?: string
}

export function useAgentOutput(sessionId: string | null) {
  const [lines, setLines] = useState<string[]>([])
  const [status, setStatus] = useState<string>('')
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setLines([])
      setStatus('')
      return
    }

    const ws = new WebSocket(`${WS_BASE}/ws?sessionId=${sessionId}`)
    wsRef.current = ws

    let gotOutput = false

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AgentOutputEvent
        if (data.type === 'line' || data.line) {
          gotOutput = true
          setLines(prev => [...prev, data.line as string])
        } else if (data.type === 'status' && data.status) {
          setStatus(data.status)
        } else if (data.type === 'end') {
          setStatus(data.metrics?.success ? 'completed' : 'errored')
        }
      } catch {}
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!gotOutput) {
        fetch(`${API_BASE}/agents/sessions/${sessionId}`, { credentials: 'include' })
          .then(r => r.json())
          .then(session => {
            if (session.outputLog) {
              setLines(session.outputLog.split('\n'))
              setStatus(session.status ?? '')
            } else {
              setStatus(session.status ?? 'unknown')
            }
          })
          .catch(() => {})
      }
    }

    return () => {
      ws.close()
    }
  }, [sessionId])

  return { lines, status }
}

export function useTaskEvents(
  onEvent: (event: { type: string; taskId?: string; projectId?: string; stage?: string }) => void,
) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    return connectWithReconnect(`${WS_BASE}/ws?channels=tasks`, {
      onMessage: (data: any) => {
        if (data?.type?.startsWith?.('task.')) cbRef.current(data)
      },
    })
  }, [])
}

export interface ChatStreamHandlers {
  onMessage: (msg: any) => void
  onProposalUpdate?: (proposalId: string, status: string) => void
  onLeadStatus?: (status: 'thinking' | 'idle') => void
  onReconnect?: () => void
}

export function useChatStream(handlersOrOnMessage: ChatStreamHandlers | ((msg: any) => void)) {
  const handlers: ChatStreamHandlers =
    typeof handlersOrOnMessage === 'function'
      ? { onMessage: handlersOrOnMessage }
      : handlersOrOnMessage
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    return connectWithReconnect(`${WS_BASE}/ws?channels=chat`, {
      onOpen: (isReconnect) => {
        if (isReconnect) ref.current.onReconnect?.()
      },
      onMessage: (data: any) => {
        if (!data?.type) return
        if (data.type === 'message' && data.message) {
          ref.current.onMessage(data.message)
        } else if (data.type === 'proposal-update' && data.proposalId && data.status) {
          ref.current.onProposalUpdate?.(data.proposalId, data.status)
        } else if (data.type === 'lead-status' && data.status) {
          ref.current.onLeadStatus?.(data.status)
        }
      },
    })
  }, [])
}

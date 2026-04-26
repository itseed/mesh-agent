'use client'
import { useEffect, useRef, useState } from 'react'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001'
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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

export function useTaskEvents(onEvent: (event: { type: string; taskId?: string; projectId?: string; stage?: string }) => void) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws?channels=tasks`)
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type?.startsWith('task.')) cbRef.current(data)
      } catch {}
    }
    return () => { ws.close() }
  }, [])
}

export function useChatStream(onMessage: (msg: any) => void) {
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws?channels=chat`)
    wsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'message' && data.message) onMessage(data.message)
      } catch {}
    }
    return () => {
      ws.close()
    }
  }, [onMessage])
}

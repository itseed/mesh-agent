'use client'
import { useEffect, useRef, useState } from 'react'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001'

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
  const [status, setStatus] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setLines([])
      setStatus(null)
      return
    }
    const ws = new WebSocket(`${WS_BASE}/ws?sessionId=${sessionId}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AgentOutputEvent
        if (data.line) setLines((prev) => [...prev, data.line as string])
        if (data.type === 'status' && data.status) setStatus(data.status)
        if (data.type === 'end') setStatus('completed')
      } catch {}
    }

    ws.onclose = () => {
      wsRef.current = null
    }

    return () => {
      ws.close()
    }
  }, [sessionId])

  return { lines, status }
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

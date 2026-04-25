'use client'
import { useEffect, useRef, useState } from 'react'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001'

export function useAgentOutput(sessionId: string | null) {
  const [lines, setLines] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sessionId) return

    const ws = new WebSocket(`${WS_BASE}/ws?sessionId=${sessionId}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as { line: string }
      setLines((prev) => [...prev, data.line])
    }

    return () => { ws.close() }
  }, [sessionId])

  return lines
}

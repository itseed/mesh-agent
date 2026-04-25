import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

class MockWebSocket {
  static instances: MockWebSocket[] = []
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  send() {}
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}
;(globalThis as any).WebSocket = MockWebSocket
;(globalThis as any).__MockWebSocket = MockWebSocket

// next/navigation mocks
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}))

if (!globalThis.crypto) {
  ;(globalThis as any).crypto = {
    randomUUID: () => Math.random().toString(36).slice(2),
  }
}

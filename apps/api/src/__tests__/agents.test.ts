import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildServer } from '../server.js'

// Mock fetch เพื่อไม่ต้อง start orchestrator จริงๆ ใน tests
vi.stubGlobal('fetch', vi.fn())

const ENV = {
  DATABASE_URL: 'postgresql://meshagent:meshagent@localhost:5432/meshagent',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_EMAIL: 'admin@example.com',
  AUTH_PASSWORD: 'changeme123',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  ORCHESTRATOR_URL: 'http://localhost:3002',
}

describe('Agents API', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let token: string

  beforeAll(async () => {
    Object.assign(process.env, ENV)
    server = await buildServer()
    const res = await server.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: ENV.AUTH_EMAIL, password: ENV.AUTH_PASSWORD },
    })
    token = res.json().token
  })

  afterAll(async () => { await server.close() })

  const auth = () => ({ authorization: `Bearer ${token}` })

  it('GET /agents proxies to orchestrator', async () => {
    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'abc', role: 'frontend', status: 'idle' }],
    })
    const res = await server.inject({ method: 'GET', url: '/agents', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('POST /agents dispatches to orchestrator', async () => {
    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'new-session', role: 'backend', status: 'running' }),
    })
    const res = await server.inject({
      method: 'POST', url: '/agents', headers: auth(),
      payload: { role: 'backend', workingDir: '/tmp', prompt: 'do something' },
    })
    expect(res.statusCode).toBe(201)
  })
})

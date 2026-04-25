import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer } from '../server.js'

describe('GET /health', () => {
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://meshagent:meshagent@localhost:5432/meshagent'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.AUTH_EMAIL = 'admin@example.com'
    process.env.AUTH_PASSWORD = 'changeme123'
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long'
    server = await buildServer()
  })

  afterAll(async () => { await server.close() })

  it('returns ok', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})

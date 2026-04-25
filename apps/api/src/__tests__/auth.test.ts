import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer } from '../server.js'

describe('Auth routes', () => {
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

  describe('POST /auth/login', () => {
    it('returns token with correct credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: 'changeme123' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toHaveProperty('token')
    })

    it('returns 401 with wrong password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: 'wrong' },
      })
      expect(response.statusCode).toBe(401)
    })

    it('returns 401 with wrong email', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'other@example.com', password: 'changeme123' },
      })
      expect(response.statusCode).toBe(401)
    })
  })

  describe('GET /auth/me', () => {
    it('returns user info with valid token', async () => {
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: 'changeme123' },
      })
      const { token } = loginResponse.json()

      const response = await server.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ email: 'admin@example.com' })
    })

    it('returns 401 without token', async () => {
      const response = await server.inject({ method: 'GET', url: '/auth/me' })
      expect(response.statusCode).toBe(401)
    })
  })
})

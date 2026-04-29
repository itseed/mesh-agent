import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import './setup.js'
import { buildServer } from '../server.js'

describe('Companion token routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let adminToken: string

  beforeAll(async () => {
    server = await buildServer()
    const res = await server.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'admin@example.com', password: 'changeme123' },
    })
    adminToken = res.json().token
  })

  afterAll(async () => { await server.close() })

  it('POST /companion/tokens creates a token and returns plaintext once', async () => {
    const res = await server.inject({
      method: 'POST', url: '/companion/tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { label: 'my-laptop' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.token).toMatch(/^mesh_comp_/)
    expect(body.id).toBeTruthy()
    expect(body.prefix).toBeTruthy()
  })

  it('GET /companion/tokens lists tokens (no plaintext)', async () => {
    const res = await server.inject({
      method: 'GET', url: '/companion/tokens',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const list = res.json()
    expect(Array.isArray(list)).toBe(true)
    expect(list[0]).not.toHaveProperty('tokenHash')
    expect(list[0]).not.toHaveProperty('token')
  })

  it('DELETE /companion/tokens/:id revokes token', async () => {
    const create = await server.inject({
      method: 'POST', url: '/companion/tokens',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { label: 'to-delete' },
    })
    const { id } = create.json()
    const del = await server.inject({
      method: 'DELETE', url: `/companion/tokens/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(del.statusCode).toBe(200)
  })

  it('GET /companion/status returns connected: false when no companion', async () => {
    const res = await server.inject({
      method: 'GET', url: '/companion/status',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().connected).toBe(false)
  })

  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/companion/tokens' })
    expect(res.statusCode).toBe(401)
  })
})

describe('Companion fs proxy routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let adminToken: string

  beforeAll(async () => {
    server = await buildServer()
    const res = await server.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'admin@example.com', password: 'changeme123' },
    })
    adminToken = res.json().token
  })

  afterAll(async () => { await server.close() })

  it('GET /companion/fs/list returns 503 when no companion connected', async () => {
    const res = await server.inject({
      method: 'GET', url: '/companion/fs/list?path=/',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('Companion not connected')
  })

  it('GET /companion/fs/stat returns 503 when no companion connected', async () => {
    const res = await server.inject({
      method: 'GET', url: '/companion/fs/stat?path=/',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('Companion not connected')
  })

  it('GET /companion/fs/list returns 400 when path is missing', async () => {
    const res = await server.inject({
      method: 'GET', url: '/companion/fs/list',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET /companion/fs/list returns 401 without auth', async () => {
    const res = await server.inject({ method: 'GET', url: '/companion/fs/list?path=/' })
    expect(res.statusCode).toBe(401)
  })
})

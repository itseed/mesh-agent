import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer } from '../server.js'
import { tasks } from '@meshagent/shared'

const ENV = {
  DATABASE_URL: 'postgresql://meshagent:meshagent@localhost:5432/meshagent',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_EMAIL: 'admin@example.com',
  AUTH_PASSWORD: 'changeme123',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
}

describe('Tasks API', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let token: string

  beforeAll(async () => {
    Object.assign(process.env, ENV)
    server = await buildServer()
    // Clean up tasks table before tests
    await server.db.delete(tasks)
    const res = await server.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: ENV.AUTH_EMAIL, password: ENV.AUTH_PASSWORD },
    })
    token = res.json().token
  })

  afterAll(async () => { await server.close() })

  const auth = () => ({ authorization: `Bearer ${token}` })

  it('GET /tasks returns empty array initially', async () => {
    const res = await server.inject({ method: 'GET', url: '/tasks', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('POST /tasks creates a task', async () => {
    const res = await server.inject({
      method: 'POST', url: '/tasks', headers: auth(),
      payload: { title: 'Build login form', stage: 'backlog' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ title: 'Build login form', stage: 'backlog' })
    expect(res.json()).toHaveProperty('id')
  })

  it('PATCH /tasks/:id/stage moves task to new stage', async () => {
    const create = await server.inject({
      method: 'POST', url: '/tasks', headers: auth(),
      payload: { title: 'Move me', stage: 'backlog' },
    })
    const { id } = create.json()

    const res = await server.inject({
      method: 'PATCH', url: `/tasks/${id}/stage`, headers: auth(),
      payload: { stage: 'in_progress' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().stage).toBe('in_progress')
  })

  it('DELETE /tasks/:id removes task', async () => {
    const create = await server.inject({
      method: 'POST', url: '/tasks', headers: auth(),
      payload: { title: 'Delete me', stage: 'backlog' },
    })
    const { id } = create.json()

    const del = await server.inject({
      method: 'DELETE', url: `/tasks/${id}`, headers: auth(),
    })
    expect(del.statusCode).toBe(204)
  })

  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/tasks' })
    expect(res.statusCode).toBe(401)
  })
})

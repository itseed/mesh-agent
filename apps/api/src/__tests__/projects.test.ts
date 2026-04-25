import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import './setup.js'
import { buildServer } from '../server.js'
import { projects } from '@meshagent/shared'

describe('Projects API', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let token: string

  beforeAll(async () => {
    server = await buildServer()
    await server.db.delete(projects)
    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@example.com', password: 'changeme123' },
    })
    token = res.json().token
  })

  afterAll(async () => { await server.close() })

  const auth = () => ({ authorization: `Bearer ${token}` })

  it('POST /projects creates a project', async () => {
    const res = await server.inject({
      method: 'POST', url: '/projects', headers: auth(),
      payload: {
        name: 'pms',
        paths: { web: '/Users/user/project/pms-web', api: '/Users/user/project/pms-api' },
        githubRepos: ['org/pms-web'],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'pms' })
  })

  it('GET /projects returns list', async () => {
    const res = await server.inject({ method: 'GET', url: '/projects', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('PATCH /projects/:id/activate sets isActive', async () => {
    const create = await server.inject({
      method: 'POST', url: '/projects', headers: auth(),
      payload: { name: 'fuse', paths: {}, githubRepos: [] },
    })
    const { id } = create.json()
    const res = await server.inject({
      method: 'PATCH', url: `/projects/${id}/activate`, headers: auth(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().isActive).toBe(true)
  })
})

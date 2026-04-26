import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { api } from '@/lib/api'

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); (globalThis as any).fetch = fetchMock })
afterEach(() => { delete (globalThis as any).fetch })

function ok(data: any) {
  return { ok: true, status: 200, json: async () => data }
}

describe('api.tasks', () => {
  it('list() fetches /tasks', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: 't1', title: 'Task 1' }]))
    const result = await api.tasks.list()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks$/),
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Task 1')
  })

  it('create() posts to /tasks with body', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 't2', title: 'New task' }))
    await api.tasks.create({ title: 'New task', stage: 'backlog' })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks$/),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('New task'),
      }),
    )
  })

  it('update() patches /tasks/:id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 't1', stage: 'done' }))
    await api.tasks.update('t1', { stage: 'done' })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks\/t1$/),
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('delete() deletes /tasks/:id', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) })
    await api.tasks.delete('t1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks\/t1$/),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('analyze() posts to /tasks/:id/analyze', async () => {
    fetchMock.mockResolvedValueOnce(ok({ ok: true }))
    await api.tasks.analyze('t1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks\/t1\/analyze$/),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('comments() fetches /tasks/:id/comments', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: 'c1', body: 'hello' }]))
    const result = await api.tasks.comments('t1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks\/t1\/comments$/),
      expect.anything(),
    )
    expect(result[0].body).toBe('hello')
  })
})

describe('api.projects', () => {
  it('list() fetches /projects', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: 'p1', name: 'MeshAgent' }]))
    const result = await api.projects.list()
    expect(result[0].name).toBe('MeshAgent')
  })

  it('create() posts to /projects', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'p2', name: 'New Project' }))
    await api.projects.create({ name: 'New Project', paths: {}, githubRepos: [] })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/projects$/),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

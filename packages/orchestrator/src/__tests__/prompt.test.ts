import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}))
vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { execFile, execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { promptRoutes } from '../routes/prompt.js'

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(promptRoutes)
  return app
}

describe('POST /prompt', () => {
  let app: FastifyInstance
  beforeEach(async () => { app = await buildApp() })
  afterEach(async () => { await app.close() })

  it('returns stdout on success', async () => {
    ;(execFile as any).mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, { stdout: '{"result":"ok"}' })
      }
    )
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'hello', timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().stdout).toBe('{"result":"ok"}')
  })

  it('returns 504 when claude is killed (timeout)', async () => {
    ;(execFile as any).mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => {
        const err: any = new Error('Process killed')
        err.killed = true
        cb(err)
      }
    )
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'hello', timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(504)
  })

  it('returns 500 on non-timeout error', async () => {
    ;(execFile as any).mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error('ENOENT: no such file'))
      }
    )
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'hello', timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toContain('ENOENT')
  })

  it('rejects prompt exceeding max length', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'x'.repeat(65 * 1024), timeoutMs: 5000 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /health/claude', () => {
  let app: FastifyInstance
  beforeEach(async () => { app = await buildApp() })
  afterEach(async () => { await app.close() })

  it('returns ok=true with resolved cmd and version', async () => {
    ;(execFileSync as any)
      .mockReturnValueOnce('/usr/local/bin/claude\n')
      .mockReturnValueOnce('claude/1.2.3 linux-x64\n')
    const res = await app.inject({ method: 'GET', url: '/health/claude' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      ok: true,
      version: 'claude/1.2.3 linux-x64',
      cmd: '/usr/local/bin/claude',
    })
  })

  it('falls back to CLAUDE_CMD when which fails', async () => {
    ;(execFileSync as any)
      .mockImplementationOnce(() => { throw new Error('not found') })
      .mockReturnValueOnce('claude/1.0.0\n')
    const res = await app.inject({ method: 'GET', url: '/health/claude' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.cmd).toBe('claude')
  })

  it('returns ok=false when claude binary is missing', async () => {
    ;(execFileSync as any)
      .mockImplementationOnce(() => { throw new Error('which: no claude') })
      .mockImplementationOnce(() => { throw new Error('ENOENT') })
    const res = await app.inject({ method: 'GET', url: '/health/claude' })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(false)
    expect(res.json().error).toBeTruthy()
  })
})

describe('POST /health/claude/token', () => {
  let app: FastifyInstance
  beforeEach(async () => { app = await buildApp() })
  afterEach(async () => { await app.close() })

  it('writes token to /root/.claude/token', async () => {
    ;(mkdirSync as any).mockReturnValue(undefined)
    ;(writeFileSync as any).mockReturnValue(undefined)
    const res = await app.inject({
      method: 'POST',
      url: '/health/claude/token',
      payload: { token: 'abc123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, path: '/root/.claude/token' })
    expect(writeFileSync).toHaveBeenCalledWith('/root/.claude/token', 'abc123', { mode: 0o600 })
  })

  it('returns 500 when write fails', async () => {
    ;(mkdirSync as any).mockReturnValue(undefined)
    ;(writeFileSync as any).mockImplementation(() => { throw new Error('Permission denied') })
    const res = await app.inject({
      method: 'POST',
      url: '/health/claude/token',
      payload: { token: 'abc123' },
    })
    expect(res.statusCode).toBe(500)
  })
})

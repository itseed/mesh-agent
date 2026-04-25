import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'
import './setup.js'

const WEBHOOK_SECRET = 'test-webhook-secret-1234567890'
process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET

const { buildServer } = await import('../server.js')

function sign(payload: string): string {
  const hmac = createHmac('sha256', WEBHOOK_SECRET)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

describe('POST /github/webhook', () => {
  let server: Awaited<ReturnType<typeof buildServer>>

  beforeAll(async () => {
    server = await buildServer()
  })

  afterAll(async () => {
    await server.close()
  })

  it('rejects requests without signature', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: { 'x-github-event': 'ping' },
      payload: { zen: 'hi' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects requests with invalid signature', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'x-github-event': 'ping',
        'x-hub-signature-256': 'sha256=deadbeef',
        'content-type': 'application/json',
      },
      payload: '{"zen":"hi"}',
    })
    expect(res.statusCode).toBe(401)
  })

  it('accepts requests with a valid signature', async () => {
    const payload = JSON.stringify({ zen: 'hello', action: 'opened' })
    const res = await server.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'x-github-event': 'ping',
        'x-hub-signature-256': sign(payload),
        'content-type': 'application/json',
      },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})

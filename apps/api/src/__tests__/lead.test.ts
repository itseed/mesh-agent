import './setup.js'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { runLead, runLeadSynthesis } from '../lib/lead.js'

const validLeadJson = JSON.stringify({
  result: JSON.stringify({
    intent: 'chat',
    reply: 'Hello!',
  }),
})

const validSynthesisJson = JSON.stringify({ result: 'Nice work!' })

function mockFetchOk(body: string) {
  ;(fetch as any).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ stdout: body }),
  })
}

function mockFetchError(status: number) {
  ;(fetch as any).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: 'upstream error' }),
  })
}

describe('runLead', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls orchestrator /prompt and returns parsed decision', async () => {
    mockFetchOk(validLeadJson)
    const { decision } = await runLead('hello', [])
    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = (fetch as any).mock.calls[0]
    expect(url).toContain('/prompt')
    expect(JSON.parse(opts.body).prompt).toContain('hello')
    expect(decision.intent).toBe('chat')
    expect(decision.reply).toBe('Hello!')
  })

  it('throws when orchestrator returns non-ok status', async () => {
    mockFetchError(504)
    await expect(runLead('hello', [])).rejects.toThrow('Orchestrator error 504')
  })

  it('throws when orchestrator is unreachable', async () => {
    ;(fetch as any).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(runLead('hello', [])).rejects.toThrow()
  })
})

describe('runLeadSynthesis', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls orchestrator /prompt and returns plain text', async () => {
    mockFetchOk(validSynthesisJson)
    const text = await runLeadSynthesis({
      agentRole: 'frontend',
      success: true,
      summary: 'done',
      prUrl: null,
      context: [],
    })
    expect(text).toBe('Nice work!')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = (fetch as any).mock.calls[0]
    expect(url).toContain('/prompt')
    expect(JSON.parse(opts.body).timeoutMs).toBe(45_000)
  })

  it('throws when orchestrator returns non-ok status', async () => {
    mockFetchError(500)
    await expect(runLeadSynthesis({
      agentRole: 'backend',
      success: false,
      summary: '',
      prUrl: null,
      context: [],
    })).rejects.toThrow('Orchestrator error 500')
  })
})

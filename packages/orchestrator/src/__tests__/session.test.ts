import { describe, it, expect, vi } from 'vitest'
import { AgentSession } from '../session.js'

const baseOpts = {
  id: 'test',
  role: 'frontend',
  workingDir: '/tmp',
  prompt: 'hello',
  claudeCmd: 'echo',
}

describe('AgentSession', () => {
  it('has pending status on creation', () => {
    const session = new AgentSession({ ...baseOpts, id: 'test-1' })
    expect(session.status).toBe('pending')
    expect(session.id).toBe('test-1')
    expect(session.role).toBe('frontend')
  })

  it('transitions to completed when echo exits cleanly', async () => {
    const session = new AgentSession({ ...baseOpts, id: 'test-2', role: 'backend' })
    await session.start()
    expect(session.status).toBe('completed')
  })

  it('emits output for stdout lines', async () => {
    const session = new AgentSession({
      ...baseOpts,
      id: 'test-3',
      role: 'qa',
      prompt: 'test output',
    })
    const lines: string[] = []
    session.on('output', (line) => lines.push(line))
    await session.start()
    expect(lines.length).toBeGreaterThan(0)
  })

  it('stop() marks the session killed', async () => {
    const session = new AgentSession({
      ...baseOpts,
      id: 'test-4',
      claudeCmd: 'sleep',
      prompt: '10',
    })
    const startPromise = session.start()
    await new Promise((r) => setTimeout(r, 50))
    session.stop()
    await startPromise
    expect(session.status).toBe('killed')
  })

  it('emits end event with metrics', async () => {
    const session = new AgentSession({ ...baseOpts, id: 'test-5' })
    const onEnd = vi.fn()
    session.on('end', onEnd)
    await session.start()
    expect(onEnd).toHaveBeenCalledOnce()
    const metrics = onEnd.mock.calls[0][0]
    expect(metrics.outputBytes).toBeGreaterThan(0)
    expect(metrics.success).toBe(true)
  })
})

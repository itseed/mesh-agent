import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentSession } from '../session.js'

describe('AgentSession', () => {
  it('has idle status on creation', () => {
    const session = new AgentSession({
      id: 'test-1',
      role: 'frontend',
      workingDir: '/tmp',
      claudeCmd: 'echo',
    })
    expect(session.status).toBe('idle')
    expect(session.id).toBe('test-1')
    expect(session.role).toBe('frontend')
  })

  it('transitions to running when started', async () => {
    const session = new AgentSession({
      id: 'test-2',
      role: 'backend',
      workingDir: '/tmp',
      claudeCmd: 'echo',
    })
    const onOutput = vi.fn()
    // echo "hello" จะ exit ทันที
    await session.start('hello', onOutput)
    expect(session.status).toBe('idle')
  })

  it('calls onOutput with stdout lines', async () => {
    const session = new AgentSession({
      id: 'test-3',
      role: 'qa',
      workingDir: '/tmp',
      claudeCmd: 'echo',
    })
    const lines: string[] = []
    await session.start('test output', (line) => lines.push(line))
    expect(lines.length).toBeGreaterThan(0)
  })

  it('stop() terminates running process', async () => {
    const session = new AgentSession({
      id: 'test-4',
      role: 'frontend',
      workingDir: '/tmp',
      claudeCmd: 'sleep',
    })
    session.start('10', () => {})
    await new Promise((r) => setTimeout(r, 50))
    session.stop()
    expect(session.status).toBe('idle')
  })
})

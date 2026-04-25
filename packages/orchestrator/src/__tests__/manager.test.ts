import { describe, it, expect, beforeEach } from 'vitest'
import { SessionManager } from '../manager.js'

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager({ claudeCmd: 'echo' })
  })

  it('starts empty', () => {
    expect(manager.listSessions()).toEqual([])
  })

  it('creates a session and returns it', () => {
    const session = manager.createSession({
      role: 'frontend',
      workingDir: '/tmp',
    })
    expect(session.role).toBe('frontend')
    expect(session.status).toBe('idle')
    expect(manager.listSessions()).toHaveLength(1)
  })

  it('getSession returns session by id', () => {
    const session = manager.createSession({ role: 'backend', workingDir: '/tmp' })
    expect(manager.getSession(session.id)).toBe(session)
  })

  it('getSession returns undefined for unknown id', () => {
    expect(manager.getSession('nonexistent')).toBeUndefined()
  })

  it('removeSession stops and removes session', () => {
    const session = manager.createSession({ role: 'qa', workingDir: '/tmp' })
    manager.removeSession(session.id)
    expect(manager.listSessions()).toHaveLength(0)
  })
})

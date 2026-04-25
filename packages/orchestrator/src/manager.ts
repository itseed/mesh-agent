import { AgentSession } from './session.js'
import type { AgentRole } from '@meshagent/shared'

interface CreateSessionOpts {
  role: AgentRole
  workingDir: string
}

interface ManagerOptions {
  claudeCmd: string
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>()
  private readonly claudeCmd: string

  constructor(opts: ManagerOptions) {
    this.claudeCmd = opts.claudeCmd
  }

  createSession(opts: CreateSessionOpts): AgentSession {
    const session = new AgentSession({
      id: crypto.randomUUID(),
      role: opts.role,
      workingDir: opts.workingDir,
      claudeCmd: this.claudeCmd,
    })
    this.sessions.set(session.id, session)
    return session
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id)
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  removeSession(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.stop()
      this.sessions.delete(id)
    }
  }
}

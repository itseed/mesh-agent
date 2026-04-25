import { spawn, ChildProcess } from 'node:child_process'
import type { AgentRole, AgentStatus } from '@meshagent/shared'

interface SessionOptions {
  id: string
  role: AgentRole
  workingDir: string
  claudeCmd: string
}

export class AgentSession {
  readonly id: string
  readonly role: AgentRole
  private _status: AgentStatus = 'idle'
  private process: ChildProcess | null = null
  private readonly workingDir: string
  private readonly claudeCmd: string

  constructor(opts: SessionOptions) {
    this.id = opts.id
    this.role = opts.role
    this.workingDir = opts.workingDir
    this.claudeCmd = opts.claudeCmd
  }

  get status(): AgentStatus {
    return this._status
  }

  start(prompt: string, onOutput: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this._status = 'running'

      this.process = spawn(this.claudeCmd, [prompt], {
        cwd: this.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const handleLine = (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean)
        lines.forEach(onOutput)
      }

      this.process.stdout?.on('data', handleLine)
      this.process.stderr?.on('data', handleLine)

      this.process.on('close', () => {
        this._status = 'idle'
        this.process = null
        resolve()
      })

      this.process.on('error', (err) => {
        this._status = 'error'
        this.process = null
        reject(err)
      })
    })
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM')
      this._status = 'idle'
      this.process = null
    }
  }
}

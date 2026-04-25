import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { AgentRole, AgentStatus, AgentSessionStatus } from '@meshagent/shared'

interface SessionOptions {
  id: string
  role: AgentRole
  workingDir: string
  prompt: string
  claudeCmd: string
  projectId?: string | null
  taskId?: string | null
  createdBy?: string | null
}

export interface SessionMetrics {
  startedAt: Date | null
  endedAt: Date | null
  durationMs: number | null
  outputBytes: number
  exitCode: number | null
  success: boolean
}

type SessionEvents = {
  output: (line: string) => void
  status: (status: AgentSessionStatus) => void
  end: (metrics: SessionMetrics) => void
  error: (err: Error) => void
}

export class AgentSession extends EventEmitter {
  readonly id: string
  readonly role: AgentRole
  readonly workingDir: string
  readonly prompt: string
  readonly projectId: string | null
  readonly taskId: string | null
  readonly createdBy: string | null
  private _status: AgentSessionStatus = 'pending'
  private process: ChildProcess | null = null
  private readonly claudeCmd: string
  private startedAt: Date | null = null
  private endedAt: Date | null = null
  private outputBytes = 0
  private exitCode: number | null = null
  private errorMessage: string | null = null

  constructor(opts: SessionOptions) {
    super()
    this.id = opts.id
    this.role = opts.role
    this.workingDir = opts.workingDir
    this.prompt = opts.prompt
    this.claudeCmd = opts.claudeCmd
    this.projectId = opts.projectId ?? null
    this.taskId = opts.taskId ?? null
    this.createdBy = opts.createdBy ?? null
  }

  get status(): AgentSessionStatus {
    return this._status
  }

  get legacyStatus(): AgentStatus {
    if (this._status === 'running' || this._status === 'pending') return 'running'
    if (this._status === 'errored') return 'error'
    return 'idle'
  }

  get pid(): number | null {
    return this.process?.pid ?? null
  }

  get error(): string | null {
    return this.errorMessage
  }

  override on<E extends keyof SessionEvents>(event: E, listener: SessionEvents[E]): this {
    return super.on(event, listener as any)
  }

  override emit<E extends keyof SessionEvents>(
    event: E,
    ...args: Parameters<SessionEvents[E]>
  ): boolean {
    return super.emit(event, ...args)
  }

  private setStatus(s: AgentSessionStatus) {
    this._status = s
    this.emit('status', s)
  }

  start(): Promise<SessionMetrics> {
    return new Promise((resolve) => {
      this.setStatus('running')
      this.startedAt = new Date()

      this.process = spawn(this.claudeCmd, [this.prompt], {
        cwd: this.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AGENT_ROLE: String(this.role) },
      })

      const handleChunk = (chunk: Buffer) => {
        this.outputBytes += chunk.length
        const lines = chunk.toString().split('\n').filter(Boolean)
        for (const line of lines) this.emit('output', line)
      }

      this.process.stdout?.on('data', handleChunk)
      this.process.stderr?.on('data', handleChunk)

      this.process.on('error', (err) => {
        this.errorMessage = err.message
        this.setStatus('errored')
        this.emit('error', err)
        this.finalize(null, false)
        resolve(this.snapshot())
      })

      this.process.on('close', (code) => {
        this.exitCode = code
        const success = code === 0
        if (this._status !== 'killed') {
          this.setStatus(success ? 'completed' : 'errored')
        }
        this.finalize(code, success)
        resolve(this.snapshot())
      })
    })
  }

  stop(): void {
    if (this.process && !this.process.killed) {
      this.setStatus('killed')
      this.process.kill('SIGTERM')
      const proc = this.process
      setTimeout(() => {
        if (proc && !proc.killed) proc.kill('SIGKILL')
      }, 5000)
    }
  }

  private finalize(code: number | null, success: boolean) {
    this.endedAt = new Date()
    this.process = null
    this.emit('end', this.snapshot(success))
  }

  snapshot(success?: boolean): SessionMetrics {
    const duration =
      this.startedAt && this.endedAt ? this.endedAt.getTime() - this.startedAt.getTime() : null
    return {
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: duration,
      outputBytes: this.outputBytes,
      exitCode: this.exitCode,
      success: success ?? this._status === 'completed',
    }
  }
}

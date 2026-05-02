import { AgentSession } from './session.js';
import type { CliProvider } from './session.js';
import { removeWorktree } from './git.js';
import type { AgentRole } from '@meshagent/shared';
import type { SessionStore } from './store.js';
import type { Streamer } from './streamer.js';
import type pino from 'pino';

interface CreateSessionOpts {
  role: AgentRole;
  workingDir: string;
  prompt: string;
  projectId?: string | null;
  taskId?: string | null;
  createdBy?: string | null;
  sessionId?: string;
  systemPrompt?: string;
  repoBaseDir?: string | null;
  cliProvider?: CliProvider | null;
}

interface ManagerOptions {
  claudeCmd: string;
  defaultCliProvider: CliProvider;
  store: SessionStore;
  streamer: Streamer;
  logger: pino.Logger;
  maxConcurrent: number;
  idleTimeoutMs: number;
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private timers = new Map<string, NodeJS.Timeout>();
  private outputBuffer = new Map<string, string[]>();

  constructor(private readonly opts: ManagerOptions) {}

  get activeCount(): number {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'running' || s.status === 'pending',
    ).length;
  }

  async createSession(input: CreateSessionOpts): Promise<AgentSession> {
    if (this.activeCount >= this.opts.maxConcurrent) {
      throw new Error(
        `Concurrency limit reached (${this.opts.maxConcurrent}). Stop a session and retry.`,
      );
    }

    const session = new AgentSession({
      id: input.sessionId ?? crypto.randomUUID(),
      role: input.role,
      workingDir: input.workingDir,
      prompt: input.prompt,
      claudeCmd: this.opts.claudeCmd,
      projectId: input.projectId,
      taskId: input.taskId,
      createdBy: input.createdBy,
      systemPrompt: input.systemPrompt,
      repoBaseDir: input.repoBaseDir,
      cliProvider: input.cliProvider ?? this.opts.defaultCliProvider,
    });
    this.sessions.set(session.id, session);

    await this.opts.store.create({
      id: session.id,
      role: String(session.role),
      workingDir: session.workingDir,
      prompt: session.prompt,
      status: 'pending',
      projectId: session.projectId,
      taskId: session.taskId,
      createdBy: session.createdBy,
    });

    this.wireSessionEvents(session);
    return session;
  }

  private wireSessionEvents(session: AgentSession): void {
    const { store, streamer, logger, idleTimeoutMs } = this.opts;

    session.on('output', (line) => {
      streamer.publishLine(session.id, line);
      this.resetIdleTimer(session.id);
      const buf = this.outputBuffer.get(session.id) ?? [];
      buf.push(line);
      if (buf.length > 200) buf.shift();
      this.outputBuffer.set(session.id, buf);
    });

    session.on('status', async (status) => {
      try {
        await store.update(session.id, {
          status,
          pid: session.pid,
          startedAt: status === 'running' ? new Date() : undefined,
        });
      } catch (err) {
        logger.warn({ err, sessionId: session.id }, 'Failed to persist session status');
      }
      streamer.publishEvent(session.id, { type: 'status', status });
    });

    session.on('end', async (metrics) => {
      try {
        await store.update(session.id, {
          status: session.status,
          exitCode: metrics.exitCode,
          error: session.error,
          endedAt: metrics.endedAt ?? new Date(),
        });
        await store.recordMetric({
          sessionId: session.id,
          role: String(session.role),
          durationMs: metrics.durationMs,
          outputBytes: metrics.outputBytes,
          success: metrics.success,
        });
      } catch (err) {
        logger.warn({ err, sessionId: session.id }, 'Failed to persist session end');
      }
      const outputLog = (this.outputBuffer.get(session.id) ?? []).join('\n');
      this.outputBuffer.delete(session.id);
      try {
        await store.update(session.id, { outputLog } as any);
      } catch (err) {
        logger.warn({ err }, 'Failed to save output log');
      }
      if (session.taskId) {
        const stage = metrics.success ? 'done' : 'in_progress';
        try {
          await store.updateTaskStage(session.taskId, stage);
        } catch (err) {
          logger.warn({ err, taskId: session.taskId }, 'Failed to update task stage');
        }
      }
      // Notify API of completion
      try {
        const { API_URL, INTERNAL_SECRET } = await import('./env.js').then((m) => m.env);
        await fetch(`${API_URL}/internal/agent-complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: JSON.stringify({
            sessionId: session.id,
            taskId: session.taskId,
            projectId: session.projectId,
            role: String(session.role),
            success: metrics.success,
            outputLog,
            exitCode: metrics.exitCode ?? null,
          }),
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to notify API of session completion');
      }
      streamer.publishEvent(session.id, { type: 'end', metrics });
      if (session.repoBaseDir && session.taskId) {
        removeWorktree(session.repoBaseDir, session.taskId).catch((err) => {
          logger.warn({ err, taskId: session.taskId }, 'Failed to remove worktree on session end');
        });
      }
      this.clearIdleTimer(session.id);
    });

    session.on('error', (err) => {
      logger.error({ err, sessionId: session.id }, 'Session error');
    });

    if (idleTimeoutMs > 0) this.resetIdleTimer(session.id);
  }

  private resetIdleTimer(id: string): void {
    this.clearIdleTimer(id);
    const timeout = this.opts.idleTimeoutMs;
    if (timeout <= 0) return;
    const t = setTimeout(() => {
      const s = this.sessions.get(id);
      if (s && s.status === 'running') {
        this.opts.logger.warn(
          { sessionId: id, timeoutMs: timeout },
          'Idle session timeout — killing',
        );
        s.stop();
      }
    }, timeout);
    this.timers.set(id, t);
  }

  private clearIdleTimer(id: string): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  getSessionOutput(id: string, fromLine = 0): { output: string; running: boolean; total: number } {
    const session = this.sessions.get(id);
    const lines = this.outputBuffer.get(id) ?? [];
    return {
      output: lines.slice(fromLine).join('\n'),
      running: !!session && session.status === 'running',
      total: lines.length,
    };
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  async removeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      session.stop();
      await this.opts.store.update(id, { status: 'killed', endedAt: new Date() });
    }
    this.sessions.delete(id);
    this.clearIdleTimer(id);
  }

  async recoverFromCrash(): Promise<number> {
    const stale = await this.opts.store.findRunning();
    for (const row of stale) {
      await this.opts.store.update(row.id, {
        status: 'errored',
        error: 'Orchestrator restarted before completion',
        endedAt: new Date(),
      });
    }
    if (stale.length > 0) {
      this.opts.logger.warn(
        { count: stale.length },
        'Marked stale running sessions as errored after restart',
      );
    }
    return stale.length;
  }

  async shutdown(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
  }
}

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { SessionManager } from '../manager.js'
import type { SessionStore } from '../store.js'
import { ensureRepo, createWorktree } from '../git.js'

const createSessionSchema = z.object({
  role: z.string().min(1).max(64),
  workingDir: z.string().min(1).max(1024),
  prompt: z.string().min(1).max(64 * 1024),
  projectId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  systemPrompt: z.string().max(8 * 1024).optional().nullable(),
  repoUrl: z.string().url().optional().nullable(),
  cliProvider: z.enum(['claude', 'gemini', 'cursor']).optional().nullable(),
})

export async function sessionRoutes(
  fastify: FastifyInstance,
  opts: { manager: SessionManager; store: SessionStore },
) {
  const { manager, store } = opts

  fastify.post('/sessions', async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    const body = parsed.data

    // If repoUrl provided, orchestrator manages clone + worktree before starting agent
    let actualWorkingDir = body.workingDir
    if (body.repoUrl && body.taskId) {
      try {
        await ensureRepo(body.workingDir, body.repoUrl)
      } catch (err: any) {
        return reply.status(500).send({ error: err.message ?? 'Failed to clone/pull repo' })
      }
      try {
        actualWorkingDir = await createWorktree(body.workingDir, body.taskId)
      } catch (err: any) {
        return reply.status(500).send({ error: err.message ?? 'Failed to create worktree' })
      }
    }

    let session
    try {
      session = await manager.createSession({
        role: body.role,
        workingDir: actualWorkingDir,
        prompt: body.prompt,
        projectId: body.projectId ?? null,
        taskId: body.taskId ?? null,
        createdBy: body.createdBy ?? null,
        systemPrompt: body.systemPrompt ?? undefined,
        repoBaseDir: body.repoUrl ? body.workingDir : null,
        cliProvider: body.cliProvider ?? undefined,
      })
    } catch (err: any) {
      return reply.status(429).send({ error: err.message ?? 'Failed to create session' })
    }

    session.start().catch((err) => {
      fastify.log.error({ sessionId: session.id, err }, 'session error')
    })

    reply.status(201)
    return { id: session.id, role: session.role, status: session.status }
  })

  fastify.get('/sessions', async () => {
    return manager.listSessions().map((s) => ({
      id: s.id,
      role: s.role,
      status: s.status,
      legacyStatus: s.legacyStatus,
      pid: s.pid,
      projectId: s.projectId,
      taskId: s.taskId,
    }))
  })

  fastify.get('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const live = manager.getSession(id)
    if (live) {
      return {
        id: live.id,
        role: live.role,
        status: live.status,
        pid: live.pid,
        projectId: live.projectId,
        taskId: live.taskId,
        error: live.error,
      }
    }
    const persisted = await store.findById(id)
    if (!persisted) return reply.status(404).send({ error: 'Session not found' })
    return persisted
  })

  fastify.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!manager.getSession(id) && !(await store.findById(id))) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    await manager.removeSession(id)
    reply.status(204).send()
  })

  fastify.get('/sessions/:id/output', async (request, reply) => {
    const { id } = request.params as { id: string }
    return opts.manager.getSessionOutput(id)
  })
}

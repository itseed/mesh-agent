import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { SessionManager } from '../manager.js'
import type { Streamer } from '../streamer.js'
import type { AgentRole } from '@meshagent/shared'

const createSessionSchema = z.object({
  role: z.enum(['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer']),
  workingDir: z.string(),
  prompt: z.string(),
})

export async function sessionRoutes(
  fastify: FastifyInstance,
  opts: { manager: SessionManager; streamer: Streamer },
) {
  const { manager, streamer } = opts

  fastify.post('/sessions', async (request, reply) => {
    const body = createSessionSchema.parse(request.body)
    const session = manager.createSession({
      role: body.role as AgentRole,
      workingDir: body.workingDir,
    })

    session
      .start(body.prompt, (line) => streamer.publishLine(session.id, line))
      .catch((err) => fastify.log.error({ sessionId: session.id, err }, 'session error'))

    reply.status(201)
    return { id: session.id, role: session.role, status: session.status }
  })

  fastify.get('/sessions', async () => {
    return manager.listSessions().map((s) => ({
      id: s.id,
      role: s.role,
      status: s.status,
    }))
  })

  fastify.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!manager.getSession(id)) {
      return reply.status(404).send({ error: 'Session not found' })
    }
    manager.removeSession(id)
    reply.status(204)
  })
}

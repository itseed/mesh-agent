import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { tasks } from '@meshagent/shared'
import { logAudit } from '../lib/audit.js'

const STAGES = ['backlog', 'in_progress', 'review', 'done'] as const

const createTaskSchema = z.object({
  title: z.string().min(1).max(512),
  description: z.string().max(64 * 1024).optional(),
  stage: z.enum(STAGES).default('backlog'),
  agentRole: z
    .string()
    .max(64)
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  projectId: z.string().optional(),
  githubPrUrl: z.string().url().max(2048).optional(),
})

const stageSchema = z.object({ stage: z.enum(STAGES) })

export async function taskRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  fastify.get('/tasks', { preHandler }, async () => {
    return fastify.db.select().from(tasks).orderBy(tasks.createdAt)
  })

  fastify.post('/tasks', { preHandler }, async (request, reply) => {
    const body = createTaskSchema.parse(request.body)
    const [task] = await fastify.db.insert(tasks).values(body).returning()
    await logAudit(fastify, request, { action: 'task.created', target: task.id })
    reply.status(201)
    return task
  })

  fastify.patch('/tasks/:id/stage', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { stage } = stageSchema.parse(request.body)
    const [task] = await fastify.db
      .update(tasks)
      .set({ stage, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
    if (!task) return reply.status(404).send({ error: 'Task not found' })
    await logAudit(fastify, request, {
      action: 'task.stage.updated',
      target: id,
      metadata: { stage },
    })
    return task
  })

  fastify.delete('/tasks/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await fastify.db.delete(tasks).where(eq(tasks.id, id)).returning()
    if (result.length === 0) return reply.status(404).send({ error: 'Task not found' })
    await logAudit(fastify, request, { action: 'task.deleted', target: id })
    reply.status(204).send()
  })
}

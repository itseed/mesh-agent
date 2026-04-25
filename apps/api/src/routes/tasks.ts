import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { tasks } from '@meshagent/shared'

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  stage: z.enum(['backlog', 'in_progress', 'review', 'done']).default('backlog'),
  agentRole: z.enum(['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer']).optional(),
  projectId: z.string().optional(),
  githubPrUrl: z.string().url().optional(),
})

const stageSchema = z.object({
  stage: z.enum(['backlog', 'in_progress', 'review', 'done']),
})

export async function taskRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  fastify.get('/tasks', { preHandler }, async () => {
    return fastify.db.select().from(tasks).orderBy(tasks.createdAt)
  })

  fastify.post('/tasks', { preHandler }, async (request, reply) => {
    const body = createTaskSchema.parse(request.body)
    const [task] = await fastify.db.insert(tasks).values(body).returning()
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
    return task
  })

  fastify.delete('/tasks/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await fastify.db.delete(tasks).where(eq(tasks.id, id))
    reply.status(204)
  })
}

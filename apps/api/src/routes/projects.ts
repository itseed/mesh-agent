import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { projects } from '@meshagent/shared'

const createProjectSchema = z.object({
  name: z.string().min(1),
  paths: z.record(z.string()).default({}),
  githubRepos: z.array(z.string()).default([]),
})

export async function projectRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  fastify.get('/projects', { preHandler }, async () => {
    return fastify.db.select().from(projects).orderBy(projects.createdAt)
  })

  fastify.post('/projects', { preHandler }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body)
    const [project] = await fastify.db.insert(projects).values(body).returning()
    reply.status(201)
    return project
  })

  fastify.patch('/projects/:id/activate', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    let project: typeof projects.$inferSelect | undefined
    await fastify.db.transaction(async (tx) => {
      await tx.update(projects).set({ isActive: false }).where(eq(projects.isActive, true))
      const [updated] = await tx
        .update(projects)
        .set({ isActive: true })
        .where(eq(projects.id, id))
        .returning()
      project = updated
    })
    if (!project) return reply.status(404).send({ error: 'Project not found' })
    return project
  })

  fastify.delete('/projects/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1)
    if (!existing.length) return reply.status(404).send({ error: 'Not found' })
    await fastify.db.delete(projects).where(eq(projects.id, id))
    return reply.status(204).send()
  })
}

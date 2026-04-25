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
    // deactivate all first (single active project)
    await fastify.db.update(projects).set({ isActive: false })
    const [project] = await fastify.db
      .update(projects)
      .set({ isActive: true })
      .where(eq(projects.id, id))
      .returning()
    if (!project) return reply.status(404).send({ error: 'Project not found' })
    return project
  })

  fastify.delete('/projects/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await fastify.db.delete(projects).where(eq(projects.id, id))
    reply.status(204)
  })
}

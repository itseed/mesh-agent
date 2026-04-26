import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { projects } from '@meshagent/shared'
import { resolveGitHubClient } from '../lib/github-client.js'

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

  // GET /projects/:id/github — fetch PRs + commits for all repos linked to this project
  fastify.get('/projects/:id/github', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [project] = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1)
    if (!project) return reply.status(404).send({ error: 'Not found' })

    const repos: string[] = project.githubRepos ?? []
    if (!repos.length) return reply.send({ prs: [], commits: [] })

    let gh
    try {
      gh = await resolveGitHubClient(fastify.redis)
    } catch {
      return reply.status(503).send({ error: 'GITHUB_TOKEN not configured' })
    }

    const results = await Promise.allSettled(
      repos.map(async (repo) => {
        const [owner, repoName] = repo.split('/')
        const [prsRes, commitsRes] = await Promise.all([
          gh.pulls.list({ owner, repo: repoName, state: 'open', per_page: 10 }),
          gh.repos.listCommits({ owner, repo: repoName, per_page: 10 }),
        ])
        return {
          repo,
          prs: prsRes.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            url: pr.html_url,
            author: pr.user?.login ?? null,
          })),
          commits: commitsRes.data.map((c) => ({
            sha: c.sha.slice(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author?.name ?? null,
            date: c.commit.author?.date ?? null,
          })),
        }
      }),
    )

    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value)
  })

  fastify.delete('/projects/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1)
    if (!existing.length) return reply.status(404).send({ error: 'Not found' })
    await fastify.db.delete(projects).where(eq(projects.id, id))
    return reply.status(204).send()
  })
}

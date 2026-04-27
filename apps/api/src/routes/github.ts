import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { eq, and } from 'drizzle-orm'
import { tasks, projects } from '@meshagent/shared'
import { resolveGitHubClient, parseRepo } from '../lib/github-client.js'
import { env, isProd } from '../env.js'
import { logAudit } from '../lib/audit.js'

const TASKS_CHANNEL = 'tasks:events'

const repoSchema = z.object({ repo: z.string() })

const createIssueSchema = z.object({
  repo: z.string(),
  title: z.string().min(1).max(256),
  body: z.string().max(65536).optional(),
  labels: z.array(z.string().max(64)).max(10).optional(),
  assignees: z.array(z.string().max(64)).max(10).optional(),
})

const listIssuesSchema = z.object({
  repo: z.string(),
  state: z.enum(['open', 'closed', 'all']).default('open'),
  labels: z.string().optional(),
})

const createPrSchema = z.object({
  repo: z.string(),
  title: z.string().min(1).max(256),
  head: z.string().min(1).max(255),
  base: z.string().min(1).max(255).default('main'),
  body: z.string().max(65536).optional(),
  draft: z.boolean().default(false),
})

function verifyGitHubSignature(secret: string, payload: Buffer, signature: string): boolean {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  const expected = Buffer.from(`sha256=${hmac.digest('hex')}`)
  const received = Buffer.from(signature)
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

export async function githubRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      const buf = body as Buffer
      ;(req as any).rawBody = buf
      try {
        done(null, buf.length === 0 ? {} : JSON.parse(buf.toString('utf8')))
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  const preHandler = [fastify.authenticate]

  fastify.get('/github/prs', { preHandler }, async (request) => {
    const { repo } = repoSchema.parse(request.query)
    const { owner, repo: repoName } = parseRepo(repo)
    const gh = await resolveGitHubClient(fastify.redis)
    const { data } = await gh.pulls.list({ owner, repo: repoName, state: 'open' })
    return data.map((pr) => ({
      id: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
      createdAt: pr.created_at,
      author: pr.user?.login,
      draft: pr.draft,
    }))
  })

  fastify.post('/github/prs', { preHandler }, async (request, reply) => {
    const body = createPrSchema.parse(request.body)
    const { owner, repo: repoName } = parseRepo(body.repo)
    const gh = await resolveGitHubClient(fastify.redis)
    try {
      const { data } = await gh.pulls.create({
        owner,
        repo: repoName,
        title: body.title,
        head: body.head,
        base: body.base,
        body: body.body,
        draft: body.draft,
      })
      await logAudit(fastify, request, {
        action: 'github.pr.created',
        target: `${body.repo}#${data.number}`,
      })
      return { id: data.number, url: data.html_url, title: data.title, state: data.state }
    } catch (e: any) {
      return reply.status(e.status ?? 502).send({ error: e.message ?? 'Failed to create PR' })
    }
  })

  fastify.get('/github/commits', { preHandler }, async (request) => {
    const { repo } = repoSchema.parse(request.query)
    const { owner, repo: repoName } = parseRepo(repo)
    const gh = await resolveGitHubClient(fastify.redis)
    const { data } = await gh.repos.listCommits({ owner, repo: repoName, per_page: 20 })
    return data.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name,
      date: c.commit.author?.date,
      url: c.html_url,
    }))
  })

  fastify.get('/github/issues', { preHandler }, async (request, reply) => {
    const { repo, state, labels } = listIssuesSchema.parse(request.query)
    const { owner, repo: repoName } = parseRepo(repo)
    const gh = await resolveGitHubClient(fastify.redis)
    try {
      const { data } = await gh.issues.listForRepo({
        owner,
        repo: repoName,
        state,
        labels,
        per_page: 50,
      })
      return data
        .filter((i) => !i.pull_request)
        .map((i) => ({
          id: i.number,
          title: i.title,
          state: i.state,
          url: i.html_url,
          author: i.user?.login,
          labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
          createdAt: i.created_at,
        }))
    } catch (e: any) {
      return reply.status(e.status ?? 502).send({ error: e.message ?? 'Failed to list issues' })
    }
  })

  fastify.post('/github/issues', { preHandler }, async (request, reply) => {
    const body = createIssueSchema.parse(request.body)
    const { owner, repo: repoName } = parseRepo(body.repo)
    const gh = await resolveGitHubClient(fastify.redis)
    try {
      const { data } = await gh.issues.create({
        owner,
        repo: repoName,
        title: body.title,
        body: body.body,
        labels: body.labels,
        assignees: body.assignees,
      })
      await logAudit(fastify, request, {
        action: 'github.issue.created',
        target: `${body.repo}#${data.number}`,
      })
      return { id: data.number, url: data.html_url, title: data.title }
    } catch (e: any) {
      return reply.status(e.status ?? 502).send({ error: e.message ?? 'Failed to create issue' })
    }
  })

  // GET /github/repos?q=searchterm&page=1 — list/search repos for authenticated user
  fastify.get('/github/repos', { preHandler }, async (request, reply) => {
    const { q, page } = request.query as { q?: string; page?: string }
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1)
    const gh = await resolveGitHubClient(fastify.redis)

    try {
      const raw = q
        ? (await gh.search.repos({ q: `${q} user:@me`, per_page: 20, page: pageNum })).data.items
        : (await gh.repos.listForAuthenticatedUser({ per_page: 30, page: pageNum, sort: 'updated' })).data

      return (raw as any[]).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        description: r.description ?? null,
        private: r.private,
        url: r.html_url,
      }))
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) {
        return reply.status(503).send({ error: 'GITHUB_TOKEN not configured or unauthorized' })
      }
      throw e
    }
  })

  fastify.post('/github/webhook', async (request, reply) => {
    const secret = env.GITHUB_WEBHOOK_SECRET
    if (!secret) {
      if (isProd) {
        request.log.error('Webhook called but GITHUB_WEBHOOK_SECRET is not configured')
        return reply.status(503).send({ error: 'Webhooks not configured' })
      }
      request.log.warn('Webhook signature check skipped (no secret in dev)')
    } else {
      const signature = request.headers['x-hub-signature-256'] as string | undefined
      const raw = (request as any).rawBody as Buffer | undefined
      if (!signature || !raw) {
        return reply.status(401).send({ error: 'Missing signature' })
      }
      if (!verifyGitHubSignature(secret, raw, signature)) {
        return reply.status(401).send({ error: 'Invalid signature' })
      }
    }

    const event = request.headers['x-github-event'] as string
    const payload = request.body as any
    request.log.info({ event, action: payload?.action }, 'GitHub webhook received')

    await fastify.redis.publish('github:events', JSON.stringify({ event, payload }))

    // PR merged → find matching task and move to done
    if (event === 'pull_request' && payload?.action === 'closed' && payload?.pull_request?.merged === true) {
      const prUrl: string = payload.pull_request.html_url
      const matched = await fastify.db
        .select({ id: tasks.id, projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.githubPrUrl, prUrl), eq(tasks.stage, 'review')))

      if (matched.length > 0) {
        await Promise.all(matched.map(async (t) => {
          await fastify.db
            .update(tasks)
            .set({ stage: 'done', updatedAt: new Date() })
            .where(eq(tasks.id, t.id))
          await fastify.redis.publish(
            TASKS_CHANNEL,
            JSON.stringify({ type: 'task.stage', taskId: t.id, stage: 'done', projectId: t.projectId }),
          )
          request.log.info({ taskId: t.id, prUrl }, 'Task auto-closed via PR merge')

          if (t.projectId) {
            const [proj] = await fastify.db
              .select({ workspacePath: projects.workspacePath })
              .from(projects)
              .where(eq(projects.id, t.projectId))
              .limit(1)
            if (proj?.workspacePath) {
              const worktreePath = path.resolve(path.dirname(proj.workspacePath), '..', 'worktrees', t.id)
              try {
                execSync(`git worktree remove ${worktreePath} --force`, {
                  cwd: proj.workspacePath,
                  stdio: 'inherit',
                })
                execSync('git worktree prune', { cwd: proj.workspacePath, stdio: 'inherit' })
              } catch (e: any) {
                request.log.warn({ err: e?.message, worktreePath }, 'Failed to remove worktree — ignoring')
              }
            }
          }
        }))
      }
    }

    return reply.status(200).send({ ok: true })
  })
}

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getGitHubClient, parseRepo } from '../lib/github-client.js'

const repoSchema = z.object({ repo: z.string() })

function verifyGitHubSignature(secret: string, payload: string, signature: string): boolean {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  const expected = Buffer.from(`sha256=${hmac.digest('hex')}`)
  const received = Buffer.from(signature)
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

export async function githubRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]
  const gh = getGitHubClient()

  // GET /github/prs?repo=owner/repo
  fastify.get('/github/prs', { preHandler }, async (request, reply) => {
    const { repo } = repoSchema.parse(request.query)
    const { owner, repo: repoName } = parseRepo(repo)
    const { data } = await gh.pulls.list({ owner, repo: repoName, state: 'open' })
    return data.map((pr) => ({
      id: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
      createdAt: pr.created_at,
      author: pr.user?.login,
    }))
  })

  // GET /github/commits?repo=owner/repo
  fastify.get('/github/commits', { preHandler }, async (request, reply) => {
    const { repo } = repoSchema.parse(request.query)
    const { owner, repo: repoName } = parseRepo(repo)
    const { data } = await gh.repos.listCommits({ owner, repo: repoName, per_page: 20 })
    return data.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name,
      date: c.commit.author?.date,
      url: c.html_url,
    }))
  })

  // POST /github/webhook — receive GitHub webhook events
  fastify.post('/github/webhook', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET
    if (secret) {
      const signature = request.headers['x-hub-signature-256'] as string
      if (!signature || !verifyGitHubSignature(secret, (request as any).rawBody, signature)) {
        return reply.status(401).send({ error: 'Invalid signature' })
      }
    }

    const event = request.headers['x-github-event'] as string
    const payload = request.body as any

    fastify.log.info({ event, action: payload.action }, 'GitHub webhook received')

    // Publish to Redis so frontend can react via WebSocket
    await fastify.redis.publish('github:events', JSON.stringify({ event, payload }))

    reply.status(200).send({ ok: true })
  })
}

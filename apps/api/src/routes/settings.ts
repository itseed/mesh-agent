import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Octokit } from '@octokit/rest'
import { eq } from 'drizzle-orm'
import { projects } from '@meshagent/shared'
import { env } from '../env.js'

const TOKEN_KEY = 'settings:github:token'
const STATE_KEY_PREFIX = 'settings:github:oauth:state:'
const STATE_TTL_SECONDS = 600

const tokenSchema = z.object({
  token: z.string().min(10),
})

const syncSchema = z.object({
  repos: z.array(z.string()).min(1),
  projectId: z.string().optional(),
})

async function getStoredToken(redis: any): Promise<string | null> {
  const raw = await redis.get(TOKEN_KEY)
  if (raw) return raw
  return env.GITHUB_TOKEN ?? null
}

function maskToken(t: string | null): string | null {
  if (!t) return null
  if (t.length <= 8) return '****'
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

export async function settingsRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  // GET /settings — current connection status
  fastify.get('/settings', { preHandler }, async () => {
    const token = await getStoredToken(fastify.redis)
    let user: { login: string; avatarUrl?: string } | null = null
    if (token) {
      try {
        const oct = new Octokit({ auth: token })
        const { data } = await oct.users.getAuthenticated()
        user = { login: data.login, avatarUrl: data.avatar_url }
      } catch {
        user = null
      }
    }
    return {
      github: {
        connected: !!user,
        tokenPreview: maskToken(token),
        oauthEnabled: !!process.env.GITHUB_OAUTH_CLIENT_ID,
        user,
      },
    }
  })

  // POST /settings/github/token — store a personal access token
  fastify.post('/settings/github/token', { preHandler }, async (request, reply) => {
    const { token } = tokenSchema.parse(request.body)
    // Validate token by calling GitHub
    try {
      const oct = new Octokit({ auth: token })
      const { data } = await oct.users.getAuthenticated()
      await fastify.redis.set(TOKEN_KEY, token)
      return { ok: true, user: { login: data.login, avatarUrl: data.avatar_url } }
    } catch (e: any) {
      return reply.status(400).send({ error: 'Invalid GitHub token' })
    }
  })

  // DELETE /settings/github/token — disconnect
  fastify.delete('/settings/github/token', { preHandler }, async (_, reply) => {
    await fastify.redis.del(TOKEN_KEY)
    reply.status(204)
  })

  // GET /settings/github/oauth/start — begin OAuth flow
  fastify.get('/settings/github/oauth/start', { preHandler }, async (request, reply) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
    if (!clientId) {
      return reply.status(400).send({
        error: 'OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or paste a personal access token instead.',
      })
    }
    const state = crypto.randomUUID()
    const userEmail = (request.user as any).email
    await fastify.redis.set(`${STATE_KEY_PREFIX}${state}`, userEmail, 'EX', STATE_TTL_SECONDS)

    const redirectUri =
      process.env.GITHUB_OAUTH_REDIRECT_URI ?? `http://localhost:${env.PORT}/settings/github/oauth/callback`
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', 'repo read:user read:org')
    url.searchParams.set('state', state)
    return { url: url.toString() }
  })

  // GET /settings/github/oauth/callback — exchange code for token
  fastify.get('/settings/github/oauth/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string }
    if (!code || !state) {
      return reply.status(400).send({ error: 'Missing code/state' })
    }

    const stored = await fastify.redis.get(`${STATE_KEY_PREFIX}${state}`)
    if (!stored) {
      return reply.status(400).send({ error: 'Invalid or expired state' })
    }
    await fastify.redis.del(`${STATE_KEY_PREFIX}${state}`)

    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      return reply.status(400).send({ error: 'OAuth not configured' })
    }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    })
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
    if (!tokenJson.access_token) {
      return reply.status(400).send({ error: tokenJson.error ?? 'Token exchange failed' })
    }

    await fastify.redis.set(TOKEN_KEY, tokenJson.access_token)

    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000'
    return reply.redirect(`${webBase}/settings?connected=1`)
  })

  // GET /settings/github/repos — list repos accessible to the user
  fastify.get('/settings/github/repos', { preHandler }, async (_, reply) => {
    const token = await getStoredToken(fastify.redis)
    if (!token) return reply.status(400).send({ error: 'Not connected to GitHub' })
    const oct = new Octokit({ auth: token })
    try {
      const { data } = await oct.repos.listForAuthenticatedUser({
        per_page: 100,
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
      })
      return data.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        owner: r.owner.login,
        private: r.private,
        description: r.description,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
      }))
    } catch (e: any) {
      return reply.status(502).send({ error: e.message ?? 'Failed to list repos' })
    }
  })

  // POST /settings/github/sync — attach repos to a project
  fastify.post('/settings/github/sync', { preHandler }, async (request, reply) => {
    const body = syncSchema.parse(request.body)
    const token = await getStoredToken(fastify.redis)
    if (!token) return reply.status(400).send({ error: 'Not connected to GitHub' })

    let targetId = body.projectId
    if (!targetId) {
      const all = await fastify.db.select().from(projects)
      const active = all.find((p) => p.isActive)
      if (!active) return reply.status(400).send({ error: 'No active project. Create or activate one first.' })
      targetId = active.id
    }

    const [current] = await fastify.db.select().from(projects).where(eq(projects.id, targetId))
    if (!current) return reply.status(404).send({ error: 'Project not found' })

    const existing = new Set<string>(current.githubRepos ?? [])
    for (const r of body.repos) existing.add(r)
    const merged = Array.from(existing)

    const [updated] = await fastify.db
      .update(projects)
      .set({ githubRepos: merged })
      .where(eq(projects.id, targetId))
      .returning()

    return { project: updated, syncedRepos: body.repos }
  })
}

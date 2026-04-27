import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Octokit } from '@octokit/rest'
import { eq } from 'drizzle-orm'
import { projects, cliProviders } from '@meshagent/shared'
import { env } from '../env.js'
import { encryptSecret } from '../lib/crypto.js'
import { TOKEN_KEY, readStoredToken } from '../lib/github-client.js'
import { logAudit } from '../lib/audit.js'

const STATE_KEY_PREFIX = 'settings:github:oauth:state:'
const STATE_TTL_SECONDS = 600

const tokenSchema = z.object({ token: z.string().min(10).max(512) })
const syncSchema = z.object({
  repos: z.array(z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)).min(1).max(100),
  projectId: z.string().optional(),
})

function maskToken(t: string | null): string | null {
  if (!t) return null
  if (t.length <= 8) return '****'
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

export async function settingsRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  fastify.get('/settings', { preHandler }, async () => {
    const token = (await readStoredToken(fastify.redis)) ?? env.GITHUB_TOKEN ?? null
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

    const reposBaseDir = (await fastify.redis.get('settings:repos:base-dir')) ?? null

    return {
      github: {
        connected: !!user,
        tokenPreview: maskToken(token),
        oauthEnabled: !!env.GITHUB_OAUTH_CLIENT_ID,
        user,
      },
      cli: {
        orchestratorUrl: env.ORCHESTRATOR_URL,
      },
      reposBaseDir,
    }
  })

  fastify.post('/settings/repos-base-dir', { preHandler }, async (request, reply) => {
    const { dir } = z.object({ dir: z.string().min(1).max(1024) }).parse(request.body)
    await fastify.redis.set('settings:repos:base-dir', dir)
    await logAudit(fastify, request, { action: 'settings.repos.base-dir.saved', target: dir })
    return { ok: true }
  })

  fastify.delete('/settings/repos-base-dir', { preHandler }, async (_, reply) => {
    await fastify.redis.del('settings:repos:base-dir')
    return { ok: true }
  })

  fastify.get('/settings/claude/test', { preHandler }, async (_, reply) => {
    try {
      const res = await fetch(`${env.ORCHESTRATOR_URL}/health/claude`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        return reply.status(502).send({ ok: false, error: 'Orchestrator error', cmd: 'unknown' })
      }
      return res.json()
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Orchestrator unreachable', cmd: 'unknown' }
    }
  })

  fastify.post('/settings/github/token', { preHandler }, async (request, reply) => {
    const { token } = tokenSchema.parse(request.body)
    try {
      const oct = new Octokit({ auth: token })
      const { data } = await oct.users.getAuthenticated()
      await fastify.redis.set(TOKEN_KEY, encryptSecret(token))
      await logAudit(fastify, request, {
        action: 'settings.github.token.saved',
        metadata: { login: data.login },
      })
      return { ok: true, user: { login: data.login, avatarUrl: data.avatar_url } }
    } catch {
      return reply.status(400).send({ error: 'Invalid GitHub token' })
    }
  })

  fastify.delete('/settings/github/token', { preHandler }, async (request, reply) => {
    await fastify.redis.del(TOKEN_KEY)
    await logAudit(fastify, request, { action: 'settings.github.token.deleted' })
    reply.status(204).send()
  })

  fastify.get('/settings/github/oauth/start', { preHandler }, async (request, reply) => {
    const clientId = env.GITHUB_OAUTH_CLIENT_ID
    if (!clientId) {
      return reply.status(400).send({
        error:
          'OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or paste a personal access token.',
      })
    }
    const state = crypto.randomUUID()
    const userId = (request.user as { id: string }).id
    await fastify.redis.set(`${STATE_KEY_PREFIX}${state}`, userId, 'EX', STATE_TTL_SECONDS)

    const redirectUri =
      env.GITHUB_OAUTH_REDIRECT_URI ?? `http://localhost:${env.PORT}/settings/github/oauth/callback`
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', 'repo read:user read:org')
    url.searchParams.set('state', state)
    return { url: url.toString() }
  })

  fastify.get('/settings/github/oauth/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string }
    if (!code || !state) return reply.status(400).send({ error: 'Missing code/state' })

    const stored = await fastify.redis.get(`${STATE_KEY_PREFIX}${state}`)
    if (!stored) return reply.status(400).send({ error: 'Invalid or expired state' })
    await fastify.redis.del(`${STATE_KEY_PREFIX}${state}`)

    const clientId = env.GITHUB_OAUTH_CLIENT_ID
    const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET
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

    await fastify.redis.set(TOKEN_KEY, encryptSecret(tokenJson.access_token))
    await logAudit(fastify, null, { action: 'settings.github.oauth.success', target: stored })

    const webBase = env.WEB_BASE_URL ?? 'http://localhost:3000'
    return reply.redirect(`${webBase}/settings?connected=1`)
  })

  fastify.get('/settings/github/repos', { preHandler }, async (_, reply) => {
    const token = (await readStoredToken(fastify.redis)) ?? env.GITHUB_TOKEN ?? null
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

  fastify.get('/settings/github/branches', { preHandler }, async (request, reply) => {
    const { repo } = request.query as { repo?: string }
    if (!repo || !repo.includes('/')) return reply.status(400).send({ error: 'repo query param required (owner/repo)' })
    const token = (await readStoredToken(fastify.redis)) ?? env.GITHUB_TOKEN ?? null
    if (!token) return reply.status(400).send({ error: 'Not connected to GitHub' })
    const [owner, repoName] = repo.split('/')
    const oct = new Octokit({ auth: token })
    try {
      const { data } = await oct.repos.listBranches({ owner, repo: repoName, per_page: 100 })
      return data.map((b) => ({ name: b.name, protected: b.protected }))
    } catch (e: any) {
      return reply.status(502).send({ error: e.message ?? 'Failed to list branches' })
    }
  })

  // CLI provider management
  const CLI_PROVIDERS = ['claude', 'gemini', 'cursor'] as const
  type ProviderSlug = typeof CLI_PROVIDERS[number]

  const cliProviderUpdateSchema = z.object({
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })

  const claudeTokenSchema = z.object({ token: z.string().min(1).max(4096) })

  fastify.get('/settings/cli', { preHandler }, async () => {
    const rows = await fastify.db.select().from(cliProviders)
    const byProvider = new Map(rows.map((r) => [r.provider, r]))
    return CLI_PROVIDERS.map((p) => {
      const row = byProvider.get(p)
      return {
        provider: p,
        enabled: row?.enabled ?? false,
        isDefault: row?.isDefault ?? false,
        createdAt: row?.createdAt ?? null,
        updatedAt: row?.updatedAt ?? null,
      }
    })
  })

  fastify.put('/settings/cli/:provider', { preHandler }, async (request, reply) => {
    const { provider } = request.params as { provider: string }
    if (!CLI_PROVIDERS.includes(provider as ProviderSlug)) {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` })
    }
    const body = cliProviderUpdateSchema.parse(request.body)
    if (Object.keys(body).length === 0) {
      return reply.status(400).send({ error: 'Nothing to update' })
    }

    const [existing] = await fastify.db
      .select()
      .from(cliProviders)
      .where(eq(cliProviders.provider, provider as ProviderSlug))
      .limit(1)

    let row
    if (existing) {
      ;[row] = await fastify.db
        .update(cliProviders)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(cliProviders.provider, provider as ProviderSlug))
        .returning()
    } else {
      ;[row] = await fastify.db
        .insert(cliProviders)
        .values({ provider: provider as ProviderSlug, ...body })
        .returning()
    }

    await logAudit(fastify, request, { action: 'settings.cli.provider.updated', target: provider, metadata: body as Record<string, unknown> })
    return row
  })

  fastify.post('/settings/cli/claude/token', { preHandler }, async (request, reply) => {
    const { token } = claudeTokenSchema.parse(request.body)
    try {
      const res = await fetch(`${env.ORCHESTRATOR_URL}/health/claude/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        return reply.status(502).send({ error: body.error ?? 'Orchestrator error' })
      }
      await logAudit(fastify, request, { action: 'settings.cli.claude.token.saved' })
      return res.json()
    } catch (e: any) {
      return reply.status(502).send({ error: e?.message ?? 'Orchestrator unreachable' })
    }
  })

  fastify.post('/settings/github/sync', { preHandler }, async (request, reply) => {
    const body = syncSchema.parse(request.body)
    const token = (await readStoredToken(fastify.redis)) ?? env.GITHUB_TOKEN ?? null
    if (!token) return reply.status(400).send({ error: 'Not connected to GitHub' })

    let targetId = body.projectId
    if (!targetId) {
      const all = await fastify.db.select().from(projects)
      const active = all.find((p) => p.isActive)
      if (!active)
        return reply.status(400).send({ error: 'No active project. Create or activate one first.' })
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

    await logAudit(fastify, request, {
      action: 'settings.github.sync',
      target: targetId,
      metadata: { repos: body.repos },
    })
    return { project: updated, syncedRepos: body.repos }
  })
}

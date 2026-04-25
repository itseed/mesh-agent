import { eq, sql } from 'drizzle-orm'
import { agentRoles, BUILTIN_AGENT_ROLES } from '@meshagent/shared'
import type { FastifyInstance } from 'fastify'

const BUILTIN_DEFINITIONS: Record<
  (typeof BUILTIN_AGENT_ROLES)[number],
  { name: string; description: string; keywords: string[] }
> = {
  frontend: {
    name: 'Frontend',
    description: 'UI / React / Next.js work',
    keywords: ['ui', 'frontend', 'react', 'nextjs', 'next.js', 'component', 'css', 'tailwind'],
  },
  backend: {
    name: 'Backend',
    description: 'API / database / business logic',
    keywords: ['api', 'backend', 'database', 'sql', 'fastify', 'auth', 'endpoint', 'route'],
  },
  mobile: {
    name: 'Mobile',
    description: 'Mobile / PWA / iOS-specific work',
    keywords: ['mobile', 'pwa', 'ios', 'android', 'expo', 'react-native'],
  },
  devops: {
    name: 'DevOps',
    description: 'Infrastructure / deploys / Docker / CI',
    keywords: ['deploy', 'docker', 'devops', 'infra', 'nginx', 'ci', 'github action', 'compose'],
  },
  designer: {
    name: 'Designer',
    description: 'UX / mockups / branding',
    keywords: ['design', 'ux', 'mockup', 'wireframe', 'figma', 'palette'],
  },
  qa: {
    name: 'QA',
    description: 'Tests / quality / regressions',
    keywords: ['test', 'qa', 'spec', 'vitest', 'jest', 'e2e', 'regression'],
  },
  reviewer: {
    name: 'Reviewer',
    description: 'Code review / second opinion',
    keywords: ['review', 'audit', 'feedback', 'pr review'],
  },
}

export async function ensureBuiltinRoles(fastify: FastifyInstance): Promise<void> {
  const [{ count }] = await fastify.db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRoles)
  if (count >= BUILTIN_AGENT_ROLES.length) return

  for (const slug of BUILTIN_AGENT_ROLES) {
    const def = BUILTIN_DEFINITIONS[slug]
    await fastify.db
      .insert(agentRoles)
      .values({
        slug,
        name: def.name,
        description: def.description,
        keywords: def.keywords,
        isBuiltin: true,
      })
      .onConflictDoNothing()
  }
}

export async function listRoles(fastify: FastifyInstance) {
  return fastify.db.select().from(agentRoles)
}

export async function findRoleBySlug(fastify: FastifyInstance, slug: string) {
  const [row] = await fastify.db.select().from(agentRoles).where(eq(agentRoles.slug, slug))
  return row ?? null
}

export interface RoleResolution {
  slug: string
  name: string
  matched: number
}

export async function detectRolesFromMessage(
  fastify: FastifyInstance,
  message: string,
): Promise<RoleResolution[]> {
  const all = await listRoles(fastify)
  const lower = message.toLowerCase()
  const hits: RoleResolution[] = []
  for (const role of all) {
    let matched = 0
    for (const kw of role.keywords) {
      if (kw && lower.includes(kw.toLowerCase())) matched += 1
    }
    if (matched > 0) hits.push({ slug: role.slug, name: role.name, matched })
  }
  hits.sort((a, b) => b.matched - a.matched)
  return hits
}

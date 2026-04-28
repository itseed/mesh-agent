// apps/api/src/lib/context-builder.ts
import type { FastifyInstance } from 'fastify'
import { eq, desc } from 'drizzle-orm'
import { projectContext, agentOutcomes } from '@meshagent/shared'

const AUTO_CONTEXT_INJECT_LIMIT = 2000  // chars injected into prompt
const OUTCOMES_LIMIT = 5

export async function buildContextBlock(
  projectId: string | null | undefined,
  fastify: FastifyInstance,
): Promise<string> {
  if (!projectId) return ''
  try {
    const [ctx] = await fastify.db
      .select()
      .from(projectContext)
      .where(eq(projectContext.projectId, projectId))
      .limit(1)

    const outcomes = await fastify.db
      .select()
      .from(agentOutcomes)
      .where(eq(agentOutcomes.projectId, projectId))
      .orderBy(desc(agentOutcomes.createdAt))
      .limit(OUTCOMES_LIMIT)

    const parts: string[] = []

    if (ctx?.brief?.trim()) {
      parts.push(`## Project Context\n${ctx.brief.trim()}`)
    }

    if (ctx?.autoContext?.trim()) {
      const truncated = ctx.autoContext.length > AUTO_CONTEXT_INJECT_LIMIT
        ? ctx.autoContext.slice(0, AUTO_CONTEXT_INJECT_LIMIT) + '\n…(truncated)'
        : ctx.autoContext
      parts.push(`## Codebase Overview\n${truncated.trim()}`)
    }

    if (outcomes.length > 0) {
      const lines = outcomes.map((o) => {
        const pr = o.prUrl ? ` — PR: ${o.prUrl}` : ' — no PR'
        return `- [${o.role}] ${o.summary}${pr}`
      })
      parts.push(`## Recent Work\n${lines.join('\n')}`)
    }

    if (parts.length === 0) return ''
    return parts.join('\n\n')
  } catch (err) {
    fastify.log.warn({ err, projectId }, 'buildContextBlock failed — skipping context injection')
    return ''
  }
}

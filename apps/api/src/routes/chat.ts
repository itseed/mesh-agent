import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { tasks, projects } from '@meshagent/shared'
import { findRoleBySlug, ensureBuiltinRoles } from '../lib/roles.js'
import { dispatchAgent, buildGitInstructions } from '../lib/dispatch.js'
import { runLead, type LeadContextMessage, type LeadDecision } from '../lib/lead.js'

const HISTORY_KEY = 'chat:lead:history'
const HISTORY_LIMIT = 200
const CHAT_CHANNEL = 'chat:events'
const PROPOSAL_KEY_PREFIX = 'chat:proposal:'
const PROPOSAL_TTL_SECONDS = 60 * 30 // 30 minutes

const imageSchema = z.object({
  name: z.string().max(256),
  mimeType: z
    .string()
    .max(128)
    .regex(/^image\/(png|jpeg|jpg|webp|gif)$/i, 'Only image MIME types are accepted'),
  data: z.string().max(8 * 1024 * 1024),
})

const sendSchema = z.object({
  message: z.string().min(1).max(16 * 1024),
  workingDir: z.string().max(1024).optional(),
  projectId: z.string().optional(),
  images: z.array(imageSchema).max(8).optional(),
})

const dispatchSchema = z.object({
  proposalId: z.string().min(1),
})

interface StoredProposal {
  id: string
  createdAt: number
  userMessage: string
  imageNote: string
  projectId: string | null
  workingDir: string
  baseBranch: string
  roles: { slug: string; reason?: string }[]
  taskBrief: { title: string; description: string }
}

interface ProposalView {
  id: string
  taskBrief: { title: string; description: string }
  roles: { slug: string; reason?: string }[]
  projectId: string | null
  baseBranch: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'lead' | 'agent'
  content: string
  timestamp: number
  imageRefs?: string[]
  meta?: {
    agentRole?: string
    sessionId?: string
    taskId?: string
    intent?: 'chat' | 'clarify' | 'dispatch'
    proposal?: ProposalView
    questions?: string[]
    confirmed?: boolean
  }
}

async function pushHistory(fastify: FastifyInstance, msg: ChatMessage) {
  await fastify.redis.rpush(HISTORY_KEY, JSON.stringify(msg))
  await fastify.redis.ltrim(HISTORY_KEY, -HISTORY_LIMIT, -1)
  await fastify.redis.publish(CHAT_CHANNEL, JSON.stringify({ type: 'message', message: msg }))
}

async function loadRecentContext(
  fastify: FastifyInstance,
  excludeContent: string,
): Promise<LeadContextMessage[]> {
  const raw = await fastify.redis.lrange(HISTORY_KEY, -20, -1)
  return raw
    .map((s: string) => JSON.parse(s) as ChatMessage)
    .filter((m) => !(m.role === 'user' && m.content === excludeContent))
    .map((m) => ({
      role: m.role,
      content: m.content,
      agentRole: m.meta?.agentRole,
    }))
}

async function resolveProjectContext(
  fastify: FastifyInstance,
  projectId: string | undefined,
  workingDir: string | undefined,
): Promise<{ projectId: string | null; workingDir: string; baseBranch: string }> {
  let resolvedWorkingDir = workingDir
  let resolvedProjectId = projectId ?? null
  let baseBranch = 'main'

  if (!resolvedWorkingDir || !resolvedProjectId) {
    const all = await fastify.db.select().from(projects)
    const fallback = all[0] ?? null
    if (fallback) {
      resolvedProjectId = resolvedProjectId ?? fallback.id
      baseBranch = fallback.baseBranch ?? 'main'
      if (!resolvedWorkingDir) {
        const firstPath = Object.values(fallback.paths ?? {})[0]
        resolvedWorkingDir = firstPath ?? '/tmp'
      }
    }
  } else {
    const [proj] = await fastify.db
      .select()
      .from(projects)
      .where(eq(projects.id, resolvedProjectId))
      .limit(1)
    if (proj) baseBranch = proj.baseBranch ?? 'main'
  }
  return {
    projectId: resolvedProjectId,
    workingDir: resolvedWorkingDir ?? '/tmp',
    baseBranch,
  }
}

async function storeProposal(fastify: FastifyInstance, p: StoredProposal): Promise<void> {
  await fastify.redis.set(
    `${PROPOSAL_KEY_PREFIX}${p.id}`,
    JSON.stringify(p),
    'EX',
    PROPOSAL_TTL_SECONDS,
  )
}

async function loadProposal(
  fastify: FastifyInstance,
  id: string,
): Promise<StoredProposal | null> {
  const raw = await fastify.redis.get(`${PROPOSAL_KEY_PREFIX}${id}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredProposal
  } catch {
    return null
  }
}

async function consumeProposal(fastify: FastifyInstance, id: string): Promise<void> {
  await fastify.redis.del(`${PROPOSAL_KEY_PREFIX}${id}`)
}

function fallbackDecision(): LeadDecision {
  return {
    intent: 'chat',
    reply:
      'ขออภัย Lead ตอบไม่ได้ในตอนนี้ (LLM ไม่ตอบกลับ) — ลองพิมพ์อีกครั้ง หรือถ้าต้องการให้สั่งงานเลย ระบุให้ชัดว่าต้องการ role อะไรทำอะไร',
  }
}

export async function chatRoutes(fastify: FastifyInstance) {
  await ensureBuiltinRoles(fastify).catch((err) =>
    fastify.log.error({ err }, 'Failed to ensure builtin roles'),
  )

  const preHandler = [fastify.authenticate]

  fastify.get('/chat/history', { preHandler }, async () => {
    const raw = await fastify.redis.lrange(HISTORY_KEY, 0, -1)
    return raw.map((s: string) => JSON.parse(s) as ChatMessage)
  })

  fastify.delete('/chat/history', { preHandler }, async (_, reply) => {
    await fastify.redis.del(HISTORY_KEY)
    reply.status(204).send()
  })

  fastify.post('/chat', { preHandler }, async (request) => {
    const body = sendSchema.parse(request.body)

    const ctx = await resolveProjectContext(fastify, body.projectId, body.workingDir)

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: body.message,
      timestamp: Date.now(),
      imageRefs: body.images?.map((img) => `${img.name} (${img.mimeType})`),
    }
    await pushHistory(fastify, userMsg)

    const recentContext = await loadRecentContext(fastify, body.message)

    let decision: LeadDecision
    try {
      decision = await runLead(body.message, recentContext)
    } catch (err) {
      fastify.log.warn({ err }, 'Lead LLM failed; using soft fallback')
      decision = fallbackDecision()
    }

    const imageNote =
      body.images && body.images.length > 0
        ? `\n\nแนบรูป ${body.images.length} ไฟล์: ${body.images.map((i) => i.name).join(', ')}`
        : ''

    let proposalView: ProposalView | undefined

    if (decision.intent === 'dispatch' && decision.taskBrief && decision.roles) {
      const proposal: StoredProposal = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        userMessage: body.message,
        imageNote,
        projectId: ctx.projectId,
        workingDir: ctx.workingDir,
        baseBranch: ctx.baseBranch,
        roles: decision.roles,
        taskBrief: decision.taskBrief,
      }
      await storeProposal(fastify, proposal)
      proposalView = {
        id: proposal.id,
        taskBrief: proposal.taskBrief,
        roles: proposal.roles,
        projectId: proposal.projectId,
        baseBranch: proposal.baseBranch,
      }
    }

    const leadMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'lead',
      content: decision.reply,
      timestamp: Date.now(),
      meta: {
        intent: decision.intent,
        ...(proposalView ? { proposal: proposalView } : {}),
        ...(decision.questions ? { questions: decision.questions } : {}),
      },
    }
    await pushHistory(fastify, leadMsg)

    return { user: userMsg, lead: leadMsg, proposal: proposalView ?? null }
  })

  fastify.post('/chat/dispatch', { preHandler }, async (request, reply) => {
    const body = dispatchSchema.parse(request.body)
    const userId = (request.user as { id: string }).id

    const proposal = await loadProposal(fastify, body.proposalId)
    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal expired or not found' })
    }
    // single-use: remove now so a double-click can't create duplicate work
    await consumeProposal(fastify, body.proposalId)

    const confirmMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `ยืนยันสั่งงาน: ${proposal.taskBrief.title}`,
      timestamp: Date.now(),
      meta: { confirmed: true },
    }
    await pushHistory(fastify, confirmMsg)

    const recentContext = await loadRecentContext(fastify, '')
    const contextLines = recentContext
      .map((m) => {
        const label =
          m.role === 'user' ? 'User' : m.role === 'lead' ? 'Lead' : `Agent[${m.agentRole ?? 'agent'}]`
        return `${label}: ${m.content}`
      })
      .join('\n\n')
    const contextBlock = contextLines
      ? `\n\n## บริบทจาก conversation ก่อนหน้า\n${contextLines}\n\n## คำสั่งปัจจุบัน`
      : ''

    const branchSuffix = Date.now().toString(36)
    const gitInstructions = buildGitInstructions(proposal.baseBranch, branchSuffix)
    const fullPrompt = `${contextBlock}\n${proposal.taskBrief.description}${proposal.imageNote}${gitInstructions}`

    const dispatched: ChatMessage[] = []
    for (const r of proposal.roles) {
      const role = await findRoleBySlug(fastify, r.slug)
      if (!role) {
        fastify.log.warn({ slug: r.slug }, 'Skipping unknown role from proposal')
        continue
      }

      let agentWorkingDir = proposal.workingDir
      if (proposal.projectId) {
        const [proj] = await fastify.db
          .select()
          .from(projects)
          .where(eq(projects.id, proposal.projectId))
          .limit(1)
        if (proj) {
          const paths = (proj.paths as Record<string, string>) ?? {}
          agentWorkingDir = paths[r.slug] ?? Object.values(paths)[0] ?? proposal.workingDir
        }
      }

      const [task] = await fastify.db
        .insert(tasks)
        .values({
          title: proposal.taskBrief.title,
          description: proposal.taskBrief.description,
          stage: 'in_progress',
          agentRole: r.slug,
          projectId: proposal.projectId ?? null,
        })
        .returning()

      const result = await dispatchAgent(r.slug, agentWorkingDir, fullPrompt, {
        projectId: proposal.projectId ?? null,
        taskId: task?.id ?? null,
        createdBy: userId,
      })

      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: result.id
          ? `[${r.slug}] เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`
          : `[${r.slug}] ยังไม่สามารถเริ่ม session ได้ — ${result.error ?? 'orchestrator ไม่ตอบ'} (task บันทึกแล้ว)`,
        timestamp: Date.now(),
        meta: {
          agentRole: r.slug,
          sessionId: result.id ?? undefined,
          taskId: task?.id,
        },
      }
      await pushHistory(fastify, agentMsg)
      dispatched.push(agentMsg)
    }

    return { confirm: confirmMsg, dispatches: dispatched }
  })

  fastify.delete('/chat/proposal/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const proposal = await loadProposal(fastify, id)
    if (!proposal) return reply.status(204).send()
    await consumeProposal(fastify, id)

    const cancelMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `ยกเลิก task ที่เสนอ: ${proposal.taskBrief.title}`,
      timestamp: Date.now(),
    }
    await pushHistory(fastify, cancelMsg)
    return reply.status(204).send()
  })
}

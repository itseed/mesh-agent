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
const PROPOSAL_PENDING_TTL = 60 * 30 // 30 minutes for pending
const PROPOSAL_RESOLVED_TTL = 60 * 60 * 24 * 7 // 7 days for consumed/cancelled (audit + UI status)

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

type ProposalStatus = 'pending' | 'consumed' | 'cancelled' | 'expired'

interface StoredProposal {
  id: string
  createdAt: number
  status: ProposalStatus
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
  status: ProposalStatus
  taskBrief: { title: string; description: string }
  roles: { slug: string; reason?: string }[]
  projectId: string | null
  baseBranch: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'lead' | 'agent' | 'system'
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
    topicReset?: boolean
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
  // Walk back further than 20 — we'll trim once we know where the topic starts
  const raw = await fastify.redis.lrange(HISTORY_KEY, -100, -1)
  const parsed = raw
    .map((s: string): ChatMessage | null => {
      try {
        return JSON.parse(s) as ChatMessage
      } catch {
        return null
      }
    })
    .filter((m): m is ChatMessage => m !== null)

  // Find the most recent topic-reset marker; everything before it is a
  // different conversation that Lead should not be carrying into context.
  let startIdx = 0
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    if (parsed[i].meta?.topicReset) {
      startIdx = i + 1
      break
    }
  }

  return parsed
    .slice(startIdx)
    .filter((m) => m.role !== 'system') // skip markers themselves
    .filter((m) => !(m.role === 'user' && m.content === excludeContent))
    .slice(-20) // cap final context size
    .map((m) => ({
      role: m.role === 'system' ? 'user' : (m.role as 'user' | 'lead' | 'agent'),
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
  const ttl = p.status === 'pending' ? PROPOSAL_PENDING_TTL : PROPOSAL_RESOLVED_TTL
  await fastify.redis.set(`${PROPOSAL_KEY_PREFIX}${p.id}`, JSON.stringify(p), 'EX', ttl)
}

// Atomic compare-and-set on proposal status. Prevents racing tabs / double-clicks
// from each passing a `status === 'pending'` check before any of them write.
// Returns the proposal as it stands AFTER the attempt:
//   - null   → key missing (expired)
//   - status === toStatus  → we won the race, caller may proceed
//   - status !== toStatus  → someone else already moved it; caller must abort
const TRANSITION_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local p = cjson.decode(raw)
if p.status == ARGV[1] then
  p.status = ARGV[2]
  redis.call('SET', KEYS[1], cjson.encode(p), 'EX', tonumber(ARGV[3]))
end
return cjson.encode(p)
`

async function transitionProposal(
  fastify: FastifyInstance,
  id: string,
  fromStatus: ProposalStatus,
  toStatus: ProposalStatus,
): Promise<StoredProposal | null> {
  const result = (await fastify.redis.eval(
    TRANSITION_LUA,
    1,
    `${PROPOSAL_KEY_PREFIX}${id}`,
    fromStatus,
    toStatus,
    String(PROPOSAL_RESOLVED_TTL),
  )) as string | null
  if (!result) return null
  let proposal: StoredProposal
  try {
    proposal = JSON.parse(result) as StoredProposal
  } catch {
    return null
  }
  if (proposal.status === toStatus) {
    await fastify.redis.publish(
      CHAT_CHANNEL,
      JSON.stringify({ type: 'proposal-update', proposalId: id, status: toStatus }),
    )
  }
  return proposal
}

function toProposalView(p: StoredProposal): ProposalView {
  return {
    id: p.id,
    status: p.status,
    taskBrief: p.taskBrief,
    roles: p.roles,
    projectId: p.projectId,
    baseBranch: p.baseBranch,
  }
}

async function enrichHistoryWithStatus(
  fastify: FastifyInstance,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const ids = Array.from(
    new Set(
      messages
        .map((m) => m.meta?.proposal?.id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  )
  if (ids.length === 0) return messages

  const keys = ids.map((id) => `${PROPOSAL_KEY_PREFIX}${id}`)
  const raws = (await fastify.redis.mget(...keys)) as (string | null)[]
  const statusById = new Map<string, ProposalStatus>()
  raws.forEach((raw, idx) => {
    if (!raw) return
    try {
      const p = JSON.parse(raw) as StoredProposal
      statusById.set(ids[idx], p.status ?? 'pending')
    } catch {
      // skip malformed
    }
  })

  return messages.map((m) => {
    const pid = m.meta?.proposal?.id
    if (!pid) return m
    const known = statusById.get(pid)
    // Proposals not in Redis (TTL expired before user acted) are treated as expired
    const status: ProposalStatus = known ?? 'expired'
    return {
      ...m,
      meta: {
        ...m.meta!,
        proposal: { ...m.meta!.proposal!, status },
      },
    }
  })
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
    const messages = raw.map((s: string) => JSON.parse(s) as ChatMessage)
    return enrichHistoryWithStatus(fastify, messages)
  })

  fastify.delete('/chat/history', { preHandler }, async (_, reply) => {
    await fastify.redis.del(HISTORY_KEY)
    reply.status(204).send()
  })

  // Insert a topic-reset marker. Past messages remain visible in history but
  // Lead's context window starts fresh from this point onward.
  fastify.post('/chat/topic', { preHandler }, async () => {
    const marker: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: '— เริ่มหัวข้อใหม่ —',
      timestamp: Date.now(),
      meta: { topicReset: true },
    }
    await pushHistory(fastify, marker)
    return { marker }
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

    // Tell any open chat panels that Lead is now thinking, so they can render
    // a typing indicator while we wait for the LLM. The 'idle' counterpart
    // fires after we push the lead reply below.
    await fastify.redis.publish(
      CHAT_CHANNEL,
      JSON.stringify({ type: 'lead-status', status: 'thinking' }),
    )

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
        status: 'pending',
        userMessage: body.message,
        imageNote,
        projectId: ctx.projectId,
        workingDir: ctx.workingDir,
        baseBranch: ctx.baseBranch,
        roles: decision.roles,
        taskBrief: decision.taskBrief,
      }
      await storeProposal(fastify, proposal)
      proposalView = toProposalView(proposal)
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
    await fastify.redis.publish(
      CHAT_CHANNEL,
      JSON.stringify({ type: 'lead-status', status: 'idle' }),
    )

    return { user: userMsg, lead: leadMsg, proposal: proposalView ?? null }
  })

  fastify.post('/chat/dispatch', { preHandler }, async (request, reply) => {
    const body = dispatchSchema.parse(request.body)
    const userId = (request.user as { id: string }).id

    // Atomic check-and-set: only the caller that flips pending→consumed proceeds.
    const proposal = await transitionProposal(fastify, body.proposalId, 'pending', 'consumed')
    if (!proposal) {
      return reply.status(410).send({ error: 'Proposal expired', status: 'expired' })
    }
    if (proposal.status !== 'consumed') {
      return reply.status(409).send({
        error: `Proposal already ${proposal.status}`,
        status: proposal.status,
      })
    }

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

      // If the orchestrator never accepted the dispatch, the task we just inserted
      // has no session backing it — surface it as blocked in the kanban so it
      // doesn't sit forever in 'in_progress' looking like real work.
      if (!result.id && task?.id) {
        await fastify.db
          .update(tasks)
          .set({ stage: 'backlog', status: 'blocked', updatedAt: new Date() })
          .where(eq(tasks.id, task.id))
      }

      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: result.id
          ? `[${r.slug}] เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`
          : `[${r.slug}] ยังไม่สามารถเริ่ม session ได้ — ${result.error ?? 'orchestrator ไม่ตอบ'} (task ถูก mark blocked)`,
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
    const proposal = await transitionProposal(fastify, id, 'pending', 'cancelled')
    if (!proposal) return reply.status(204).send()
    if (proposal.status !== 'cancelled') {
      // already consumed or cancelled by another caller — idempotent no-op
      return reply.status(204).send()
    }

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

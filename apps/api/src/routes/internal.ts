import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, ne, count } from 'drizzle-orm'
import { tasks, taskComments } from '@meshagent/shared'
import { env } from '../env.js'
import { runLeadSynthesis, type LeadContextMessage } from '../lib/lead.js'

const HISTORY_KEY = 'chat:lead:history'
const HISTORY_LIMIT = 200
const CHAT_CHANNEL = 'chat:events'
const TASKS_CHANNEL = 'tasks:events'

const bodySchema = z.object({
  sessionId: z.string(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  role: z.string(),
  success: z.boolean(),
  outputLog: z.string().optional().default(''),
  exitCode: z.number().nullable().optional(),
})

function extractPrUrl(output: string): string | null {
  const match = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)
  return match?.[0] ?? null
}

function buildSummary(output: string): string {
  const block = output.match(/TASK_COMPLETE[\s\S]*?END_TASK_COMPLETE/)
  if (block) {
    const summaryMatch = block[0].match(/summary:\s*(.+)/)
    if (summaryMatch) return summaryMatch[1].trim()
  }
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.slice(-3).join(' ').slice(0, 300)
}

async function pushChatMessage(fastify: FastifyInstance, message: object) {
  const str = JSON.stringify(message)
  await fastify.redis.rpush(HISTORY_KEY, str)
  await fastify.redis.ltrim(HISTORY_KEY, -HISTORY_LIMIT, -1)
  await fastify.redis.publish(CHAT_CHANNEL, JSON.stringify({ type: 'message', message }))
}

interface RawChatMessage {
  role: 'user' | 'lead' | 'agent'
  content: string
  meta?: { agentRole?: string }
}

async function loadRecentContext(fastify: FastifyInstance): Promise<LeadContextMessage[]> {
  const raw = await fastify.redis.lrange(HISTORY_KEY, -20, -1)
  return raw
    .map((s: string): LeadContextMessage | null => {
      try {
        const m = JSON.parse(s) as RawChatMessage
        return { role: m.role, content: m.content, agentRole: m.meta?.agentRole }
      } catch {
        return null
      }
    })
    .filter((m): m is LeadContextMessage => m !== null)
}

async function synthesizeAfterCompletion(
  fastify: FastifyInstance,
  input: {
    agentRole: string
    success: boolean
    summary: string
    prUrl: string | null
  },
): Promise<void> {
  try {
    const context = await loadRecentContext(fastify)
    const reply = await runLeadSynthesis({
      agentRole: input.agentRole,
      success: input.success,
      summary: input.summary,
      prUrl: input.prUrl,
      context,
    })
    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'lead' as const,
      content: reply,
      timestamp: Date.now(),
      meta: { intent: 'chat' as const, synthesisFor: input.agentRole },
    })
  } catch (err) {
    fastify.log.warn({ err, role: input.agentRole }, 'Lead synthesis failed; skipping')
  }
}

export async function internalRoutes(fastify: FastifyInstance) {
  fastify.post('/internal/agent-complete', async (request, reply) => {
    const secret = request.headers['x-internal-secret']
    if (secret !== env.INTERNAL_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const body = bodySchema.parse(request.body)
    const { taskId, role, success, outputLog, projectId } = body

    const prUrl = extractPrUrl(outputLog)
    const summary = buildSummary(outputLog)
    const stage = success ? (prUrl ? 'review' : 'done') : 'in_progress'

    // 1. Update task stage + save output as comment
    if (taskId) {
      await fastify.db
        .update(tasks)
        .set({ stage, updatedAt: new Date() })
        .where(eq(tasks.id, taskId))

      const commentBody = [
        `**Agent [${role}] ${success ? 'เสร็จแล้ว ✓' : 'มีข้อผิดพลาด ✕'}**`,
        '',
        summary ? `**สรุป:** ${summary}` : '',
        prUrl ? `**PR:** ${prUrl}` : '',
        '',
        '```',
        outputLog.split('\n').slice(-50).join('\n'),
        '```',
      ].filter(l => l !== undefined).join('\n')

      await fastify.db.insert(taskComments).values({
        taskId,
        body: commentBody,
        source: 'agent',
        authorId: null,
      })

      await fastify.redis.publish(TASKS_CHANNEL, JSON.stringify({ type: 'task.stage', taskId, stage, projectId }))

      // 2. Check parent task — if all subtasks done → mark parent done
      const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
      if (task?.parentTaskId) {
        const [{ value: pendingCount }] = await fastify.db
          .select({ value: count() })
          .from(tasks)
          .where(
            and(
              eq(tasks.parentTaskId, task.parentTaskId),
              ne(tasks.stage, 'done'),
              ne(tasks.id, taskId),
            )
          )
        if (Number(pendingCount) === 0) {
          await fastify.db
            .update(tasks)
            .set({ stage: 'done', updatedAt: new Date() })
            .where(eq(tasks.id, task.parentTaskId))
          await fastify.redis.publish(TASKS_CHANNEL, JSON.stringify({ type: 'task.stage', taskId: task.parentTaskId, stage: 'done', projectId }))
        }
      }
    }

    // 3. Push completion message to Lead chat
    const statusIcon = success ? '✓' : '✕'
    const chatMsg = {
      id: crypto.randomUUID(),
      role: 'agent' as const,
      content: [
        `[${role}] ${statusIcon} ${success ? 'เสร็จแล้ว' : 'มีข้อผิดพลาด'}`,
        summary ? `สรุป: ${summary}` : '',
        prUrl ? `PR: ${prUrl}` : '',
      ].filter(Boolean).join('\n'),
      timestamp: Date.now(),
      meta: {
        agentRole: role,
        prUrl: prUrl ?? undefined,
        success,
      },
    }

    await pushChatMessage(fastify, chatMsg)

    // Lead debrief — fire-and-forget so the orchestrator response stays snappy.
    // The synthesis pushes its own chat message via Redis pub/sub when ready.
    void synthesizeAfterCompletion(fastify, {
      agentRole: role,
      success,
      summary,
      prUrl,
    })

    return reply.status(200).send({ ok: true })
  })
}

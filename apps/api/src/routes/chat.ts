import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { tasks, projects } from '@meshagent/shared'
import { env } from '../env.js'
import { detectRolesFromMessage, ensureBuiltinRoles, findRoleBySlug } from '../lib/roles.js'

const HISTORY_KEY = 'chat:lead:history'
const HISTORY_LIMIT = 200
const CHAT_CHANNEL = 'chat:events'

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
  }
}

async function pushHistory(fastify: FastifyInstance, msg: ChatMessage) {
  await fastify.redis.rpush(HISTORY_KEY, JSON.stringify(msg))
  await fastify.redis.ltrim(HISTORY_KEY, -HISTORY_LIMIT, -1)
  await fastify.redis.publish(CHAT_CHANNEL, JSON.stringify({ type: 'message', message: msg }))
}

async function dispatchAgent(
  role: string,
  workingDir: string,
  prompt: string,
  context: { projectId?: string | null; taskId?: string | null; createdBy?: string | null },
): Promise<{ id: string | null; error?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(`${env.ORCHESTRATOR_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, workingDir, prompt, ...context }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      return { id: null, error: err.error ?? `Orchestrator returned ${res.status}` }
    }
    const data = (await res.json()) as { id?: string }
    return { id: data.id ?? null }
  } catch (e: any) {
    return { id: null, error: e?.message ?? 'Orchestrator request failed' }
  } finally {
    clearTimeout(timer)
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

  fastify.post('/chat', { preHandler }, async (request, reply) => {
    const body = sendSchema.parse(request.body)
    const userId = (request.user as { id: string }).id

    let workingDir = body.workingDir
    let projectId = body.projectId
    let baseBranch = 'main'

    if (!workingDir || !projectId) {
      const all = await fastify.db.select().from(projects)
      const fallback = all[0] ?? null
      if (fallback) {
        projectId = projectId ?? fallback.id
        baseBranch = fallback.baseBranch ?? 'main'
        if (!workingDir) {
          const firstPath = Object.values(fallback.paths ?? {})[0]
          workingDir = firstPath ?? '/tmp'
        }
      }
    } else {
      const [proj] = await fastify.db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
      if (proj) baseBranch = proj.baseBranch ?? 'main'
    }
    workingDir = workingDir ?? '/tmp'

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: body.message,
      timestamp: Date.now(),
      imageRefs: body.images?.map((img) => `${img.name} (${img.mimeType})`),
    }
    await pushHistory(fastify, userMsg)

    const detected = await detectRolesFromMessage(fastify, body.message)
    const targetSlugs =
      detected.length > 0 ? detected.slice(0, 4).map((r) => r.slug) : ['reviewer']

    const planLines = [
      `รับคำสั่งเรียบร้อย — กระจายงานให้ ${targetSlugs.length} agent`,
      ...targetSlugs.map((s) => `  • ${s}`),
    ]
    const leadMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'lead',
      content: planLines.join('\n'),
      timestamp: Date.now(),
    }
    await pushHistory(fastify, leadMsg)

    const imageNote =
      body.images && body.images.length > 0
        ? `\n\nแนบรูป ${body.images.length} ไฟล์: ${body.images.map((i) => i.name).join(', ')}`
        : ''

    const branchSuffix = Date.now().toString(36)
    const gitInstructions = `

## Git Workflow (REQUIRED — ทำทุกครั้ง)
Base branch: \`${baseBranch}\`

**ก่อนเริ่มงาน:**
\`\`\`bash
git fetch origin
git checkout ${baseBranch}
git pull origin ${baseBranch}
git checkout -b task/\${ROLE}-${branchSuffix}
\`\`\`
(แทน \${ROLE} ด้วย role ของตัวเอง เช่น frontend, backend)

**ระหว่างทำงาน:** commit บ่อยๆ

**เมื่องานเสร็จ:**
\`\`\`bash
git push -u origin HEAD
gh pr create --base ${baseBranch} --title "<สรุปงานที่ทำ>" --body "<รายละเอียด>"
\`\`\`

**สำคัญ:** แจ้ง PR URL กลับมาในรายงานสุดท้ายด้วย`

    const fullPrompt = `${body.message}${imageNote}${gitInstructions}`

    const dispatched: ChatMessage[] = []
    for (const slug of targetSlugs) {
      const role = await findRoleBySlug(fastify, slug)
      if (!role) {
        fastify.log.warn({ slug }, 'Skipping unknown role from detection')
        continue
      }

      // resolve working dir per role from project paths
      let agentWorkingDir = workingDir
      if (projectId) {
        const [proj] = await fastify.db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
        if (proj) {
          const paths = proj.paths as Record<string, string> ?? {}
          agentWorkingDir = paths[slug] ?? Object.values(paths)[0] ?? workingDir
        }
      }

      const [task] = await fastify.db
        .insert(tasks)
        .values({
          title: body.message.slice(0, 80),
          description: body.message,
          stage: 'in_progress',
          agentRole: slug,
          projectId: projectId ?? null,
        })
        .returning()

      const result = await dispatchAgent(slug, agentWorkingDir, fullPrompt, {
        projectId: projectId ?? null,
        taskId: task?.id ?? null,
        createdBy: userId,
      })

      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: result.id
          ? `[${slug}] เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`
          : `[${slug}] ยังไม่สามารถเริ่ม session ได้ — ${result.error ?? 'orchestrator ไม่ตอบ'} (task บันทึกแล้ว)`,
        timestamp: Date.now(),
        meta: {
          agentRole: slug,
          sessionId: result.id ?? undefined,
          taskId: task?.id,
        },
      }
      await pushHistory(fastify, agentMsg)
      dispatched.push(agentMsg)
    }

    return { user: userMsg, lead: leadMsg, dispatches: dispatched }
  })
}

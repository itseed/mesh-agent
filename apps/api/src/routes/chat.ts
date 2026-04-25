import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { tasks, projects } from '@meshagent/shared'
import type { AgentRole } from '@meshagent/shared'
import { env } from '../env.js'

const HISTORY_KEY = 'chat:lead:history'
const HISTORY_LIMIT = 200

const ROLES: AgentRole[] = ['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer']

// Map keywords (English + Thai) to agent roles. The Lead uses these to fan out tasks.
const ROLE_KEYWORDS: Record<AgentRole, string[]> = {
  frontend: ['frontend', 'หน้าเว็บ', 'หน้าจอ', 'ui', 'react', 'next', 'css', 'tailwind', 'หน้าตา', 'ฟอนต์', 'styling'],
  backend: ['backend', 'api', 'endpoint', 'database', 'sql', 'fastify', 'server', 'หลังบ้าน'],
  mobile: ['mobile', 'ios', 'android', 'มือถือ', 'แอป', 'react native', 'expo'],
  devops: ['devops', 'docker', 'deploy', 'ci', 'cd', 'pipeline', 'kubernetes', 'k8s', 'ดีพลอย'],
  designer: ['design', 'figma', 'ออกแบบ', 'ดีไซน์', 'mockup', 'wireframe'],
  qa: ['qa', 'test', 'testing', 'ทดสอบ', 'เทส', 'จุนิต', 'unit test', 'e2e'],
  reviewer: ['review', 'รีวิว', 'audit', 'ตรวจ'],
}

const imageSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  data: z.string(), // base64
})

const sendSchema = z.object({
  message: z.string().min(1),
  workingDir: z.string().optional(),
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
    agentRole?: AgentRole
    sessionId?: string
    taskId?: string
  }
}

function detectRoles(text: string): AgentRole[] {
  const lower = text.toLowerCase()
  const matched: AgentRole[] = []
  for (const role of ROLES) {
    if (ROLE_KEYWORDS[role].some((kw) => lower.includes(kw.toLowerCase()))) {
      matched.push(role)
    }
  }
  return matched
}

async function pushHistory(redis: any, msg: ChatMessage) {
  await redis.rpush(HISTORY_KEY, JSON.stringify(msg))
  await redis.ltrim(HISTORY_KEY, -HISTORY_LIMIT, -1)
}

async function dispatchAgent(role: AgentRole, workingDir: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${env.ORCHESTRATOR_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, workingDir, prompt }),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    return data.id ?? null
  } catch {
    return null
  }
}

export async function chatRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  // GET /chat/history — recent chat messages
  fastify.get('/chat/history', { preHandler }, async () => {
    const raw = await fastify.redis.lrange(HISTORY_KEY, 0, -1)
    return raw.map((s: string) => JSON.parse(s) as ChatMessage)
  })

  // DELETE /chat/history — clear chat
  fastify.delete('/chat/history', { preHandler }, async (_, reply) => {
    await fastify.redis.del(HISTORY_KEY)
    reply.status(204)
  })

  // POST /chat — user sends a message to Lead, Lead plans + dispatches
  fastify.post('/chat', { preHandler }, async (request, reply) => {
    const body = sendSchema.parse(request.body)

    // Resolve target project + working directory
    let workingDir = body.workingDir
    let projectId = body.projectId
    if (!workingDir || !projectId) {
      const all = await fastify.db.select().from(projects)
      const active = all.find((p) => p.isActive) ?? null
      if (active) {
        projectId = projectId ?? active.id
        if (!workingDir) {
          const firstPath = Object.values(active.paths ?? {})[0]
          workingDir = firstPath ?? '/tmp'
        }
      }
    }
    workingDir = workingDir ?? '/tmp'

    // Persist user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: body.message,
      timestamp: Date.now(),
      imageRefs: body.images?.map((img) => `${img.name} (${img.mimeType})`),
    }
    await pushHistory(fastify.redis, userMsg)

    // Lead plans which roles to dispatch
    const detected = detectRoles(body.message)
    const targetRoles: AgentRole[] = detected.length > 0 ? detected : ['reviewer']

    // Lead's reply summarises the plan
    const planLines = [
      `รับคำสั่งเรียบร้อย — กระจายงานให้ ${targetRoles.length} agent`,
      ...targetRoles.map((r) => `  • ${r}`),
    ]
    const leadMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'lead',
      content: planLines.join('\n'),
      timestamp: Date.now(),
    }
    await pushHistory(fastify.redis, leadMsg)

    // Build the prompt the agent will receive (with image context, if any)
    const imageNote =
      body.images && body.images.length > 0
        ? `\n\nแนบรูป ${body.images.length} ไฟล์: ${body.images.map((i) => i.name).join(', ')}`
        : ''
    const fullPrompt = `${body.message}${imageNote}`

    // Create a Kanban task and dispatch an agent for each target role
    const dispatched: ChatMessage[] = []
    for (const role of targetRoles) {
      const [task] = await fastify.db
        .insert(tasks)
        .values({
          title: body.message.slice(0, 80),
          description: body.message,
          stage: 'in_progress',
          agentRole: role,
          projectId: projectId ?? null,
        })
        .returning()

      const sessionId = await dispatchAgent(role, workingDir, fullPrompt)

      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: sessionId
          ? `[${role}] เริ่มทำงานแล้ว (session ${sessionId.slice(0, 8)})`
          : `[${role}] ยังไม่สามารถเริ่ม session ได้ — orchestrator ไม่ตอบ แต่บันทึกเป็น task แล้ว`,
        timestamp: Date.now(),
        meta: { agentRole: role, sessionId: sessionId ?? undefined, taskId: task?.id },
      }
      await pushHistory(fastify.redis, agentMsg)
      dispatched.push(agentMsg)
    }

    return {
      user: userMsg,
      lead: leadMsg,
      dispatches: dispatched,
    }
  })
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type LeadIntent = 'chat' | 'clarify' | 'dispatch'

export interface LeadProposalRole {
  slug: string
  reason?: string
}

export interface LeadDecision {
  intent: LeadIntent
  reply: string
  roles?: LeadProposalRole[]
  taskBrief?: {
    title: string
    description: string
  }
  questions?: string[]
}

export interface LeadContextMessage {
  role: 'user' | 'lead' | 'agent'
  content: string
  agentRole?: string
}

const LEAD_SYSTEM_PROMPT = `You are the Lead of a software development team using the MeshAgent platform. The user talks to you via a chat box. You manage a team of specialist agents (frontend, backend, mobile, devops, designer, qa, reviewer).

Your job is to behave like a real tech lead during a stand-up:
- If the user is asking a question, chatting, or thinking out loud → just talk back. Do not create work.
- If the user's request is ambiguous, missing scope, or could be interpreted multiple ways → ask clarifying questions before committing to work.
- Only when the request is concrete and ready to execute, propose a task brief plus the right team roles. Do NOT execute it yet — the user must confirm.

You always reply in the same language the user used (Thai → Thai, English → English).

Output ONLY one valid JSON object — no markdown, no commentary, no extra text — with this schema:

{
  "intent": "chat" | "clarify" | "dispatch",
  "reply": "<your message to the user, conversational tone, in their language>",
  "roles": [{ "slug": "frontend|backend|mobile|devops|designer|qa|reviewer", "reason": "..." }],
  "taskBrief": { "title": "<short, <=80 chars>", "description": "<full task description for the agents>" },
  "questions": ["<clarifying question>", ...]
}

Rules:
- "chat": user is asking a question, greeting, or discussing — reply only, omit roles/taskBrief/questions.
- "clarify": you need more info — set "questions" with 1–3 specific questions; omit roles/taskBrief.
- "dispatch": ready to assign work — fill "roles" (1–4 of them) and "taskBrief". The "reply" should briefly summarize the plan and ask the user to confirm. Do NOT promise that work has started.
- Never invent role slugs outside the allowed list.
- Pick the smallest viable set of roles. Don't add a reviewer or qa unless the user asked for review/testing or the change is risky.
- Keep "reply" concise (a few sentences max).`

function buildPrompt(message: string, context: LeadContextMessage[]): string {
  const lines = [LEAD_SYSTEM_PROMPT, '', '## Conversation so far']
  if (context.length === 0) {
    lines.push('(no prior messages)')
  } else {
    for (const m of context) {
      const label =
        m.role === 'user' ? 'User' : m.role === 'lead' ? 'Lead' : `Agent[${m.agentRole ?? 'agent'}]`
      lines.push(`${label}: ${m.content}`)
    }
  }
  lines.push('', '## Current user message', message, '', 'Respond now with the JSON object only.')
  return lines.join('\n')
}

function extractJson(text: string): string | null {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed.result === 'string') {
      const inner = parsed.result.trim()
      const match = inner.match(/\{[\s\S]*\}/)
      return match ? match[0] : null
    }
  } catch {
    // not the wrapper — try direct
  }
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}

const ALLOWED_ROLES = new Set([
  'frontend',
  'backend',
  'mobile',
  'devops',
  'designer',
  'qa',
  'reviewer',
])

function sanitizeDecision(raw: unknown): LeadDecision {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Lead returned non-object response')
  }
  const obj = raw as Record<string, unknown>
  const intent = obj.intent
  if (intent !== 'chat' && intent !== 'clarify' && intent !== 'dispatch') {
    throw new Error(`Lead returned invalid intent: ${String(intent)}`)
  }
  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : ''
  if (!reply) throw new Error('Lead returned empty reply')

  const decision: LeadDecision = { intent, reply }

  if (intent === 'dispatch') {
    const rolesRaw = Array.isArray(obj.roles) ? obj.roles : []
    const roles: LeadProposalRole[] = []
    const seen = new Set<string>()
    for (const r of rolesRaw) {
      if (!r || typeof r !== 'object') continue
      const slug = String((r as Record<string, unknown>).slug ?? '').toLowerCase()
      if (!ALLOWED_ROLES.has(slug) || seen.has(slug)) continue
      seen.add(slug)
      const reason = (r as Record<string, unknown>).reason
      roles.push({ slug, reason: typeof reason === 'string' ? reason : undefined })
    }
    if (roles.length === 0) {
      throw new Error('Lead chose dispatch but returned no valid roles')
    }
    decision.roles = roles.slice(0, 4)

    const briefRaw = obj.taskBrief
    if (!briefRaw || typeof briefRaw !== 'object') {
      throw new Error('Lead chose dispatch but taskBrief missing')
    }
    const brief = briefRaw as Record<string, unknown>
    const title = typeof brief.title === 'string' ? brief.title.trim().slice(0, 80) : ''
    const description = typeof brief.description === 'string' ? brief.description.trim() : ''
    if (!title || !description) {
      throw new Error('Lead taskBrief missing title or description')
    }
    decision.taskBrief = { title, description }
  }

  if (intent === 'clarify') {
    const qRaw = Array.isArray(obj.questions) ? obj.questions : []
    const questions = qRaw
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 5)
    if (questions.length > 0) decision.questions = questions
  }

  return decision
}

export async function runLead(
  message: string,
  context: LeadContextMessage[],
): Promise<LeadDecision> {
  const cmd = process.env.CLAUDE_CMD ?? 'claude'
  const prompt = buildPrompt(message, context)
  const { stdout } = await execFileAsync(cmd, ['--output-format', 'json', '-p', prompt], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env },
  })
  const jsonText = extractJson(stdout)
  if (!jsonText) throw new Error('Lead CLI returned no JSON')
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('Lead CLI returned invalid JSON')
  }
  return sanitizeDecision(parsed)
}

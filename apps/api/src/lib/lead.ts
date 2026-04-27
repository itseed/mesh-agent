import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'

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

const DEFAULT_LEAD_SYSTEM_PROMPT = `You are the Lead of a software development team using the MeshAgent platform. The user talks to you via a chat box. You manage a team of specialist agents (frontend, backend, mobile, devops, designer, qa, reviewer).

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
- "dispatch": ready to assign work — fill "roles" and "taskBrief". The "reply" should briefly summarize the plan and ask the user to confirm. Do NOT promise that work has started.
- Strongly prefer assigning ONE role. Only use multiple roles when the change truly spans separate areas (e.g. backend API + frontend integration) AND those areas can be worked on in parallel without conflicts. When in doubt, pick one role and let the user request more after that finishes.
- Never invent role slugs outside the allowed list.
- Don't add a reviewer or qa unless the user asked for review/testing or the change is risky.
- Keep "reply" concise (a few sentences max).`

function loadLeadSystemPrompt(): string {
  // Highest priority: literal env (good for docker-compose / .env)
  const inline = process.env.LEAD_SYSTEM_PROMPT
  if (inline && inline.trim()) return inline
  // Next: a file path (good for editing without re-encoding multiline strings)
  const file = process.env.LEAD_SYSTEM_PROMPT_FILE
  if (file && file.trim()) {
    try {
      const text = readFileSync(file, 'utf8').trim()
      if (text) return text
    } catch (err) {
      console.warn('[lead] Failed to read LEAD_SYSTEM_PROMPT_FILE, falling back to default:', err)
    }
  }
  return DEFAULT_LEAD_SYSTEM_PROMPT
}

const LEAD_SYSTEM_PROMPT = loadLeadSystemPrompt()

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

export interface SynthesisInput {
  agentRole: string
  success: boolean
  summary: string
  prUrl?: string | null
  context: LeadContextMessage[]
}

const DEFAULT_SYNTHESIS_SYSTEM_PROMPT = `You are the Lead of a software development team. One of your specialist agents just finished a task. Your job is to give the user a short, conversational debrief — like a tech lead delivering an update at the end of a stand-up.

Reply in the same language the user has been using in the conversation (default Thai if unclear).

Style:
- 1–3 short sentences. No bullet lists, no headings.
- Start by acknowledging what was done (or what failed).
- If a PR exists, mention it once.
- End with a concrete, useful next step the user might want — e.g. "ลองรัน QA ต่อไหม?", "อยากให้ frontend เชื่อมต่อ endpoint ใหม่นี้เลยไหม?", "เปิด PR review เลยนะ ดีไหม?". Phrase as a question so the user can just say yes/no.
- If the agent failed, briefly note the failure and suggest either retry or asking for diagnosis.
- Do NOT propose multi-step plans, do NOT list code changes, do NOT include the PR description verbatim.

Output ONLY plain text — no JSON, no markdown formatting, no quotes around your reply. Just the message you'd send in chat.`

function loadSynthesisSystemPrompt(): string {
  const inline = process.env.LEAD_SYNTHESIS_PROMPT
  if (inline && inline.trim()) return inline
  const file = process.env.LEAD_SYNTHESIS_PROMPT_FILE
  if (file && file.trim()) {
    try {
      const text = readFileSync(file, 'utf8').trim()
      if (text) return text
    } catch (err) {
      console.warn('[lead] Failed to read LEAD_SYNTHESIS_PROMPT_FILE, falling back to default:', err)
    }
  }
  return DEFAULT_SYNTHESIS_SYSTEM_PROMPT
}

const SYNTHESIS_SYSTEM_PROMPT = loadSynthesisSystemPrompt()

function buildSynthesisPrompt(input: SynthesisInput): string {
  const lines = [SYNTHESIS_SYSTEM_PROMPT, '', '## Recent conversation']
  if (input.context.length === 0) {
    lines.push('(no prior messages)')
  } else {
    for (const m of input.context) {
      const label =
        m.role === 'user' ? 'User' : m.role === 'lead' ? 'Lead' : `Agent[${m.agentRole ?? 'agent'}]`
      lines.push(`${label}: ${m.content}`)
    }
  }
  lines.push('')
  lines.push('## Agent completion event')
  lines.push(`Role: ${input.agentRole}`)
  lines.push(`Outcome: ${input.success ? 'success' : 'failure'}`)
  if (input.summary) lines.push(`Agent summary: ${input.summary}`)
  if (input.prUrl) lines.push(`Pull request: ${input.prUrl}`)
  lines.push('')
  lines.push('Now write your debrief message to the user.')
  return lines.join('\n')
}

export async function runLeadSynthesis(input: SynthesisInput): Promise<string> {
  const cmd = process.env.CLAUDE_CMD ?? 'claude'
  const prompt = buildSynthesisPrompt(input)
  const { stdout } = await execFileAsync(cmd, ['--output-format', 'json', '-p', prompt], {
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env },
  })
  // CLI returns { result: "..." } — pull out plain text
  let text = stdout.trim()
  try {
    const wrapper = JSON.parse(text)
    if (typeof wrapper.result === 'string') text = wrapper.result.trim()
  } catch {
    // not wrapped
  }
  // strip code fences / surrounding quotes that some models emit despite the rule
  text = text.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim()
  }
  if (!text) throw new Error('Lead synthesis returned empty text')
  return text
}

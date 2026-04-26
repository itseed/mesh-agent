import { execFileSync } from 'node:child_process'

export interface SubtaskPlan {
  title: string
  description?: string
  agentRole?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
}

export interface AnalyzePlan {
  summary: string
  subtasks: SubtaskPlan[]
}

export async function analyzeTask(title: string, description?: string | null): Promise<AnalyzePlan> {
  const CLAUDE_CMD = process.env.CLAUDE_CMD ?? 'claude'
  const prompt = [
    'You are the Lead of a software development team.',
    'Analyze the following task and break it down into concrete subtasks for your team.',
    'Output ONLY a single valid JSON object — no markdown, no explanation, no extra text.',
    'Schema: { "summary": "one sentence overview", "subtasks": [{ "title": "...", "description": "...", "agentRole": "frontend|backend|mobile|devops|designer|qa|reviewer", "priority": "low|medium|high|urgent" }] }',
    '',
    `Task: ${title}`,
    description ? `Description: ${description}` : '',
  ].join('\n')

  let stdout: string
  try {
    stdout = execFileSync(CLAUDE_CMD, ['--output-format', 'json', '-p', prompt], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env },
    })
  } catch (err: any) {
    const msg = err?.stderr ?? err?.message ?? 'Claude CLI failed'
    throw new Error(msg)
  }

  // claude --output-format json returns: { result: "...", ... }
  let text = stdout.trim()
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed.result === 'string') text = parsed.result
  } catch {}

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude CLI did not return valid JSON plan')
  try {
    return JSON.parse(jsonMatch[0]) as AnalyzePlan
  } catch {
    throw new Error('Failed to parse plan JSON from Claude output')
  }
}

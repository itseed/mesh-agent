import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env.js'

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
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const prompt = [
    'You are a Lead of a software development team. Analyze the following task and break it down into concrete subtasks.',
    'Return ONLY valid JSON matching this schema:',
    '{ "summary": "brief overview", "subtasks": [{ "title": "...", "description": "...", "agentRole": "frontend|backend|mobile|devops|designer|qa|reviewer", "priority": "low|medium|high|urgent" }] }',
    '',
    `Task: ${title}`,
    description ? `Description: ${description}` : '',
  ].join('\n')

  const message = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (message.content[0] as any).text as string
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude did not return valid JSON')
  return JSON.parse(jsonMatch[0]) as AnalyzePlan
}

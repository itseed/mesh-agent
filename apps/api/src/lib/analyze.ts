import { env } from '../env.js';

export interface SubtaskPlan {
  title: string;
  description?: string;
  agentRole?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  wave: number; // 1 = first parallel group, 2 = runs after wave 1, etc.
}

export interface AnalyzePlan {
  summary: string;
  subtasks: SubtaskPlan[];
}

export async function analyzeTask(
  title: string,
  description?: string | null,
): Promise<AnalyzePlan> {
  const prompt = [
    'You are the Lead of a software development team.',
    'Analyze the following task and break it down into concrete subtasks for your team.',
    'Output ONLY a single valid JSON object — no markdown, no explanation, no extra text.',
    'Schema: { "summary": "one sentence overview", "subtasks": [{ "title": "...", "description": "...", "agentRole": "frontend|backend|mobile|devops|designer|qa|reviewer", "priority": "low|medium|high|urgent", "wave": 1 }] }',
    'Wave rules: wave 1 = parallel work (implementation, investigation, analysis). wave 2 = work that depends on wave 1 results (synthesis, QA test, code review). wave 3+ = further sequential steps if needed.',
    '',
    `Task: ${title}`,
    description ? `Description: ${description}` : '',
  ].join('\n');

  const res = await fetch(`${env.ORCHESTRATOR_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeoutMs: 120_000 }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Orchestrator prompt failed: ${res.status}`);
  }

  const data = (await res.json()) as { stdout: string };
  let text = data.stdout.trim();

  // claude --output-format json returns: { result: "...", ... }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.result === 'string') text = parsed.result;
  } catch {}

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON plan');
  try {
    return JSON.parse(jsonMatch[0]) as AnalyzePlan;
  } catch {
    throw new Error('Failed to parse plan JSON from Claude output');
  }
}

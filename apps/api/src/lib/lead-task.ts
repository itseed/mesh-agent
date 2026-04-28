// apps/api/src/lib/lead-task.ts
import type { LeadWave } from './wave-store.js'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4802'

export interface LeadTaskResult {
  waves: LeadWave[]
  taskBrief: { title: string; description: string }
}

async function callOrchestrator(prompt: string): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeoutMs: 60_000 }),
    signal: AbortSignal.timeout(65_000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(`Orchestrator error ${res.status}: ${body.error ?? 'unknown'}`)
  }
  const { stdout } = await res.json() as { stdout: string }
  return stdout
}

function buildPrompt(
  task: { title: string; description?: string | null },
  localFilePaths: string[],
  projectPaths: Record<string, string>,
): string {
  const pathLines = Object.entries(projectPaths)
    .map(([role, dir]) => `  ${role}: ${dir}`)
    .join('\n')

  const fileLines = localFilePaths.map((p) => `- ${p}`).join('\n')

  return [
    'You are the Lead of a software development team. A task is ready to be worked on.',
    '',
    `Task: ${task.title}`,
    `Description: ${task.description?.trim() || '(no description provided)'}`,
    '',
    Object.keys(projectPaths).length > 0
      ? `Working directories by role:\n${pathLines}`
      : '(no project paths configured — agents will use their default working directory)',
    '',
    localFilePaths.length > 0
      ? `Attached requirement files — use the Read tool on each path before planning:\n${fileLines}`
      : '(no attachments)',
    '',
    'Plan the work as sequential waves of agents.',
    'Roles within one wave run in parallel. Use multiple waves only when there is a clear sequential dependency (e.g. backend API must exist before frontend can integrate it).',
    'Strongly prefer a single wave with one role unless the task genuinely requires multiple sequential steps.',
    '',
    'Role slugs allowed: frontend, backend, mobile, devops, designer, qa, reviewer',
    '',
    'Output valid JSON only — no markdown, no commentary:',
    '{',
    '  "waves": [',
    '    { "roles": [{"slug":"backend","reason":"..."}], "brief": "what wave 1 accomplishes" },',
    '    { "roles": [{"slug":"frontend"}], "brief": "what wave 2 accomplishes" }',
    '  ],',
    '  "taskBrief": {',
    '    "title": "<task title, <=80 chars>",',
    '    "description": "<expanded description for the agents — include relevant file paths from attachments if any>"',
    '  }',
    '}',
    '',
    'Reply in Thai if the task title is Thai, otherwise English.',
  ].join('\n')
}

const ALLOWED_ROLES = new Set(['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer'])

function parseResult(stdout: string): LeadTaskResult {
  let text = stdout.trim()
  try {
    const w = JSON.parse(text)
    if (typeof w.result === 'string') text = w.result.trim()
    else if (typeof w.stdout === 'string') text = w.stdout.trim()
  } catch { /* not wrapped */ }

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Lead task returned no JSON. Raw: ${text.slice(0, 300)}`)

  const parsed = JSON.parse(match[0]) as Record<string, unknown>

  const wavesRaw = Array.isArray(parsed.waves) ? parsed.waves : []
  const waves: LeadWave[] = []
  for (const w of wavesRaw) {
    if (!w || typeof w !== 'object') continue
    const wObj = w as Record<string, unknown>
    const rolesRaw = Array.isArray(wObj.roles) ? wObj.roles : []
    const roles: LeadWave['roles'] = []
    for (const r of rolesRaw) {
      if (!r || typeof r !== 'object') continue
      const slug = String((r as Record<string, unknown>).slug ?? '').toLowerCase()
      if (!ALLOWED_ROLES.has(slug)) continue
      const reason = (r as Record<string, unknown>).reason
      roles.push({ slug, reason: typeof reason === 'string' ? reason : undefined })
    }
    if (roles.length === 0) continue
    const brief = typeof wObj.brief === 'string' ? wObj.brief.trim() : ''
    waves.push({ roles, brief })
  }
  if (waves.length === 0) throw new Error('Lead task returned no valid waves')

  const briefRaw = parsed.taskBrief as Record<string, unknown> | undefined
  const title = typeof briefRaw?.title === 'string' ? briefRaw.title.trim().slice(0, 80) : ''
  const description = typeof briefRaw?.description === 'string' ? briefRaw.description.trim() : ''
  if (!title || !description) throw new Error('Lead task returned invalid taskBrief')

  return { waves, taskBrief: { title, description } }
}

export async function runLeadTask(
  task: { title: string; description?: string | null },
  localFilePaths: string[],
  projectPaths: Record<string, string>,
): Promise<LeadTaskResult> {
  const stdout = await callOrchestrator(buildPrompt(task, localFilePaths, projectPaths))
  return parseResult(stdout)
}

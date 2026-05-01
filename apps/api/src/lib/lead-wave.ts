// apps/api/src/lib/lead-wave.ts
import type { WaveState } from './wave-store.js';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4802';

export interface WaveEvalResult {
  proceed: boolean;
  ask: boolean;
  message: string;
}

async function callOrchestrator(prompt: string): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, timeoutMs: 30_000 }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Orchestrator error ${res.status}: ${body.error ?? 'unknown'}`);
  }
  const { stdout } = (await res.json()) as { stdout: string };
  return stdout;
}

function buildPrompt(state: WaveState): string {
  const nextWave = state.waves[state.currentWave + 1];
  const results = state.completedSessions
    .map((s) => `- ${s.role} (${s.success ? 'success' : 'FAILED'}): ${s.summary}`)
    .join('\n');
  const nextDesc = nextWave
    ? `Next wave (${state.currentWave + 1}): "${nextWave.brief}" — Roles: ${nextWave.roles.map((r) => r.slug).join(', ')}`
    : 'This was the final wave.';

  return [
    `You are the Lead of a software development team. Wave ${state.currentWave} has just completed for task: "${state.taskTitle}"`,
    '',
    'Wave results:',
    results || '(no results recorded)',
    '',
    nextDesc,
    '',
    nextWave
      ? 'Decide: should we auto-proceed to the next wave, or does the user need to be consulted first?'
      : 'All waves are complete. Write a brief completion summary for the user.',
    '',
    'Rules:',
    '- All agents succeeded + next wave exists → { "proceed": true, "ask": false, "message": "..." }',
    '- Partial failure but clearly safe to continue → { "proceed": true, "ask": false, "message": "note the issue, still proceeding" }',
    '- Significant failure or ambiguous outcome → { "proceed": false, "ask": true, "message": "describe the problem and ask what to do" }',
    '- Final wave complete (no next wave) → { "proceed": false, "ask": false, "message": "completion summary" }',
    '- Reply in the same language the task title uses (Thai or English).',
    '',
    'Respond with valid JSON only — no markdown, no commentary:',
    '{ "proceed": true|false, "ask": true|false, "message": "<your message to the user>" }',
  ].join('\n');
}

function parseResult(stdout: string): WaveEvalResult {
  let text = stdout.trim();
  try {
    const w = JSON.parse(text);
    if (typeof w.result === 'string') text = w.result.trim();
    else if (typeof w.stdout === 'string') text = w.stdout.trim();
  } catch {
    /* not the wrapper format */
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Wave eval returned no JSON. Raw: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    proceed: parsed.proceed === true,
    ask: parsed.ask === true,
    message:
      typeof parsed.message === 'string' ? parsed.message.trim() : 'Wave evaluation complete.',
  };
}

export async function runWaveEvaluation(state: WaveState): Promise<WaveEvalResult> {
  const stdout = await callOrchestrator(buildPrompt(state));
  return parseResult(stdout);
}

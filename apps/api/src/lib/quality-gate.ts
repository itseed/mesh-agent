// apps/api/src/lib/quality-gate.ts
import type { FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { taskActivities } from '@meshagent/shared'
import { dispatchAgent } from './dispatch.js'
import { findRoleBySlug } from './roles.js'

const QG_TTL = 86400 // 24 h

export interface QualityGateState {
  taskId: string
  reviewerSessionId: string
  prUrls: string[]
  projectId: string | null
  projectPaths: Record<string, string>
  baseBranch: string
  branchSuffix: string
  createdBy: string
  attempt: number             // starts at 0; escalate when attempt >= 2
  taskTitle: string
  taskDescription: string
}

export interface ReviewerVerdict {
  verdict: 'pass' | 'block'
  fixRoles: { slug: string; brief: string }[]
  issues: { severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; description: string }[]
  message: string
}

const qgStateKey = (taskId: string) => `qg:state:${taskId}`
const qgSessionKey = (sessionId: string) => `qg:session:${sessionId}`

export async function saveQgState(redis: Redis, state: QualityGateState): Promise<void> {
  await redis.set(qgStateKey(state.taskId), JSON.stringify(state), 'EX', QG_TTL)
}

export async function getQgState(redis: Redis, taskId: string): Promise<QualityGateState | null> {
  const raw = await redis.get(qgStateKey(taskId))
  if (!raw) return null
  try { return JSON.parse(raw) as QualityGateState } catch { return null }
}

export async function deleteQgState(redis: Redis, taskId: string): Promise<void> {
  await redis.del(qgStateKey(taskId))
}

export async function indexQgSession(redis: Redis, sessionId: string, taskId: string): Promise<void> {
  await redis.set(qgSessionKey(sessionId), taskId, 'EX', QG_TTL)
}

export async function lookupQgSession(redis: Redis, sessionId: string): Promise<string | null> {
  return redis.get(qgSessionKey(sessionId))
}

export async function removeQgSessionIndex(redis: Redis, sessionId: string): Promise<void> {
  await redis.del(qgSessionKey(sessionId))
}

function buildReviewerPrompt(opts: {
  taskTitle: string
  taskDescription: string
  prUrls: string[]
  baseBranch: string
}): string {
  const prLines = opts.prUrls.map((u) => `- ${u}`).join('\n')
  return [
    'You are a code reviewer. Your job is to check a completed task before it is marked done.',
    '',
    `Task: ${opts.taskTitle}`,
    `Description: ${opts.taskDescription}`,
    '',
    'PRs to review:',
    prLines,
    '',
    'For each PR:',
    '1. Extract the PR number from the URL and run: gh pr checkout <number>',
    `2. git diff origin/${opts.baseBranch}...HEAD — inspect all changes`,
    '3. Review for: OWASP Top 10 security issues, logic correctness, edge cases, code quality',
    '4. Discover and run the test suite:',
    '   - Check package.json "scripts.test" → npm test',
    '   - Check for pytest.ini or pyproject.toml → pytest',
    '   - Check for vitest.config.ts or jest.config.ts → npx vitest run or npx jest',
    '   - If no test suite found: note it in summary, do NOT block for this reason',
    '',
    'Block criteria (verdict must be "block"):',
    '  - Any issue with severity CRITICAL',
    '  - Any test command exits non-zero',
    'Pass criteria (verdict must be "pass"):',
    '  - No CRITICAL issues AND all tests pass (or no test suite found)',
    '  - MEDIUM and LOW issues are fine — include them in issues[] but still pass',
    '',
    'Output ONLY this TASK_COMPLETE block — no other text after it:',
    'TASK_COMPLETE',
    'summary: <1-2 sentence summary of what you found>',
    'verdict_json: {"verdict":"pass","fixRoles":[],"issues":[],"message":"<shown in chat to user>"}',
    'END_TASK_COMPLETE',
  ].join('\n')
}

export function parseVerdictJson(outputLog: string): ReviewerVerdict | null {
  const block = outputLog.match(/TASK_COMPLETE[\s\S]*?END_TASK_COMPLETE/)
  if (!block) return null
  const match = block[0].match(/verdict_json:\s*(\{[\s\S]*?\})(?:\n|$)/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as ReviewerVerdict
  } catch {
    return null
  }
}

export async function triggerQualityGate(
  fastify: FastifyInstance,
  taskId: string,
  prUrls: string[],
  projectPaths: Record<string, string>,
  opts: {
    projectId: string | null
    baseBranch: string
    branchSuffix: string
    createdBy: string
    taskTitle: string
    taskDescription: string
  },
): Promise<void> {
  // Read existing QG state to preserve attempt counter across retry loops
  const existing = await getQgState(fastify.redis, taskId)
  const attempt = existing?.attempt ?? 0

  const reviewerWorkingDir = Object.values(projectPaths)[0] ?? '/tmp'
  const prompt = buildReviewerPrompt({
    taskTitle: opts.taskTitle,
    taskDescription: opts.taskDescription,
    prUrls,
    baseBranch: opts.baseBranch,
  })

  const role = await findRoleBySlug(fastify, 'reviewer')
  const result = await dispatchAgent(
    'reviewer',
    reviewerWorkingDir,
    prompt,
    { projectId: opts.projectId, taskId: null, createdBy: opts.createdBy },
    role?.systemPrompt ?? undefined,
  )

  if (!result.id) {
    fastify.log.warn({ taskId, error: result.error }, 'Quality gate reviewer dispatch failed — skipping')
    return
  }

  const state: QualityGateState = {
    taskId,
    reviewerSessionId: result.id,
    prUrls,
    projectId: opts.projectId,
    projectPaths,
    baseBranch: opts.baseBranch,
    branchSuffix: opts.branchSuffix,
    createdBy: opts.createdBy,
    attempt,
    taskTitle: opts.taskTitle,
    taskDescription: opts.taskDescription,
  }
  await saveQgState(fastify.redis, state)
  await indexQgSession(fastify.redis, result.id, taskId)

  try {
    await fastify.db.insert(taskActivities).values({
      taskId,
      actorId: null,
      type: 'quality_gate.started',
      payload: { attempt, prUrls },
    })
  } catch (err) {
    fastify.log.warn({ err, taskId }, 'Failed to log quality_gate.started activity')
  }
}

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, ne, count } from 'drizzle-orm'
import { tasks, taskComments, taskActivities, projects, agentOutcomes } from '@meshagent/shared'
import { env } from '../env.js'
import { runLeadSynthesis, type LeadContextMessage } from '../lib/lead.js'
import {
  lookupSessionProposal,
  getWaveState,
  updateWaveState,
  deleteWaveState,
  saveWaveState,
  removeSessionIndex,
  indexSession,
  type WaveState,
} from '../lib/wave-store.js'
import {
  lookupQgSession,
  removeQgSessionIndex,
  getQgState,
  saveQgState,
  deleteQgState,
  parseVerdictJson,
  triggerQualityGate,
  type QualityGateState,
} from '../lib/quality-gate.js'
import { runWaveEvaluation } from '../lib/lead-wave.js'
import { dispatchAgent, buildGitInstructions } from '../lib/dispatch.js'
import { findRoleBySlug } from '../lib/roles.js'
import { buildContextBlock } from '../lib/context-builder.js'

const HISTORY_KEY = 'chat:lead:history'
const HISTORY_LIMIT = 200
const CHAT_CHANNEL = 'chat:events'
const TASKS_CHANNEL = 'tasks:events'

const bodySchema = z.object({
  sessionId: z.string(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  role: z.string(),
  success: z.boolean(),
  outputLog: z.string().optional().default(''),
  exitCode: z.number().nullable().optional(),
})

function extractPrUrl(output: string): string | null {
  const match = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)
  return match?.[0] ?? null
}

function buildSummary(output: string): string {
  const block = output.match(/TASK_COMPLETE[\s\S]*?END_TASK_COMPLETE/)
  if (block) {
    const summaryMatch = block[0].match(/summary:\s*(.+)/)
    if (summaryMatch) return summaryMatch[1].trim()
  }
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.slice(-3).join(' ').slice(0, 300)
}

async function pushChatMessage(fastify: FastifyInstance, message: object) {
  const str = JSON.stringify(message)
  await fastify.redis.rpush(HISTORY_KEY, str)
  await fastify.redis.ltrim(HISTORY_KEY, -HISTORY_LIMIT, -1)
  await fastify.redis.publish(CHAT_CHANNEL, JSON.stringify({ type: 'message', message }))
}

interface RawChatMessage {
  role: 'user' | 'lead' | 'agent' | 'system'
  content: string
  meta?: { agentRole?: string; topicReset?: boolean }
}

async function loadRecentContext(fastify: FastifyInstance): Promise<LeadContextMessage[]> {
  const raw = await fastify.redis.lrange(HISTORY_KEY, -100, -1)
  const parsed = raw
    .map((s: string): RawChatMessage | null => {
      try {
        return JSON.parse(s) as RawChatMessage
      } catch {
        return null
      }
    })
    .filter((m): m is RawChatMessage => m !== null)

  let startIdx = 0
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    if (parsed[i].meta?.topicReset) {
      startIdx = i + 1
      break
    }
  }

  return parsed
    .slice(startIdx)
    .filter((m) => m.role !== 'system')
    .slice(-20)
    .map((m) => ({
      role: m.role as 'user' | 'lead' | 'agent',
      content: m.content,
      agentRole: m.meta?.agentRole,
    }))
}

async function synthesizeAfterCompletion(
  fastify: FastifyInstance,
  input: {
    agentRole: string
    success: boolean
    summary: string
    prUrl: string | null
  },
): Promise<void> {
  await fastify.redis
    .publish(CHAT_CHANNEL, JSON.stringify({ type: 'lead-status', status: 'thinking' }))
    .catch(() => {})
  try {
    const context = await loadRecentContext(fastify)
    const reply = await runLeadSynthesis({
      agentRole: input.agentRole,
      success: input.success,
      summary: input.summary,
      prUrl: input.prUrl,
      context,
    })
    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'lead' as const,
      content: reply,
      timestamp: Date.now(),
      meta: { intent: 'chat' as const, synthesisFor: input.agentRole },
    })
  } catch (err) {
    fastify.log.warn({ err, role: input.agentRole }, 'Lead synthesis failed; skipping')
  } finally {
    await fastify.redis
      .publish(CHAT_CHANNEL, JSON.stringify({ type: 'lead-status', status: 'idle' }))
      .catch(() => {})
  }
}

async function logTaskActivity(
  fastify: FastifyInstance,
  taskId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fastify.db.insert(taskActivities).values({ taskId, actorId: null, type, payload })
    await fastify.redis.publish(
      TASKS_CHANNEL,
      JSON.stringify({ type: 'task.activity', taskId, activityType: type }),
    )
  } catch (err) {
    fastify.log.warn({ err, taskId, type }, 'Failed to log task activity')
  }
}

async function dispatchNextWave(fastify: FastifyInstance, state: WaveState, waveIndex: number): Promise<string[]> {
  const wave = state.waves[waveIndex]
  if (!wave) return []

  let projectPaths: Record<string, string> = {}
  if (state.projectId) {
    const [proj] = await fastify.db
      .select()
      .from(projects)
      .where(eq(projects.id, state.projectId))
      .limit(1)
    if (proj) projectPaths = (proj.paths as Record<string, string>) ?? {}
  }

  // Inject previous wave summaries so agents have artifact context
  const prevSummary = state.completedSessions
    .map((s) => `[${s.role}] ${s.success ? '✓' : '✗'}: ${s.summary}`)
    .join('\n')
  const waveSummaryBlock = prevSummary
    ? `\n\n## ผลงานจาก Wave ก่อนหน้า\n${prevSummary}\n\n## คำสั่งปัจจุบัน`
    : ''

  const imageBlock = state.imagePaths.length > 0
    ? `\n\n## Attached images\n${state.imagePaths.map((p) => `- ${p}`).join('\n')}`
    : ''

  const projectCtxBlock = await buildContextBlock(state.projectId, fastify)
  const gitInstructions = buildGitInstructions(state.baseBranch, state.branchSuffix)
  const fullPrompt = `${projectCtxBlock ? projectCtxBlock + '\n\n' : ''}${waveSummaryBlock}\n${state.taskDescription}${imageBlock}${gitInstructions}`

  const pendingSessions: string[] = []

  for (const r of wave.roles) {
    const role = await findRoleBySlug(fastify, r.slug)
    if (!role) {
      fastify.log.warn({ slug: r.slug }, 'dispatchNextWave: skipping unknown role')
      continue
    }

    const agentWorkingDir = projectPaths[r.slug] ?? Object.values(projectPaths)[0] ?? '/tmp'

    const [task] = await fastify.db
      .insert(tasks)
      .values({
        title: state.taskTitle,
        description: state.taskDescription,
        stage: 'in_progress',
        agentRole: r.slug,
        projectId: state.projectId ?? null,
      })
      .returning()

    if (task?.id) {
      await fastify.redis.publish(
        TASKS_CHANNEL,
        JSON.stringify({ type: 'task.created', taskId: task.id, projectId: state.projectId ?? null }),
      )
    }

    const result = await dispatchAgent(r.slug, agentWorkingDir, fullPrompt, {
      projectId: state.projectId ?? null,
      taskId: task?.id ?? null,
      createdBy: state.createdBy,
    }, role?.systemPrompt ?? undefined)

    if (!result.id && task?.id) {
      await fastify.db
        .update(tasks)
        .set({ stage: 'backlog', status: 'blocked', updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
    }

    if (result.id) {
      pendingSessions.push(result.id)
      await indexSession(fastify.redis, result.id, state.proposalId)
    }

    await pushChatMessage(fastify, {
      id: crypto.randomUUID(),
      role: 'agent' as const,
      content: result.id
        ? `[${r.slug}] Wave ${waveIndex} เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`
        : `[${r.slug}] ไม่สามารถเริ่ม session ได้ — ${result.error ?? 'orchestrator ไม่ตอบ'}`,
      timestamp: Date.now(),
      meta: { agentRole: r.slug, sessionId: result.id ?? undefined },
    })
  }

  return pendingSessions
}

export async function internalRoutes(fastify: FastifyInstance) {
  fastify.post('/internal/agent-complete', async (request, reply) => {
    const secret = request.headers['x-internal-secret']
    if (secret !== env.INTERNAL_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const body = bodySchema.parse(request.body)

    // ── Quality Gate reviewer completion ──────────────────────────────────────
    // Check if this session belongs to a QG reviewer BEFORE any regular logic.
    // Reviewer sessions have taskId: null so the task-update block below is a
    // no-op for them, but we return early to avoid synthesis.
    try {
      const qgTaskId = await lookupQgSession(fastify.redis, body.sessionId)
      if (qgTaskId) {
        await removeQgSessionIndex(fastify.redis, body.sessionId)
        const qgState = await getQgState(fastify.redis, qgTaskId)
        if (qgState) {
          const verdict = parseVerdictJson(body.outputLog)

          if (verdict?.verdict === 'pass') {
            // ── Pass ──────────────────────────────────────────────────────────
            await fastify.db
              .update(tasks)
              .set({ stage: 'done', updatedAt: new Date() })
              .where(eq(tasks.id, qgTaskId))
            await fastify.redis.publish(
              TASKS_CHANNEL,
              JSON.stringify({ type: 'task.stage', taskId: qgTaskId, stage: 'done', projectId: qgState.projectId }),
            )
            await logTaskActivity(fastify, qgTaskId, 'quality_gate.passed', {
              attempt: qgState.attempt,
              issueCount: verdict.issues.length,
            })
            await pushChatMessage(fastify, {
              id: crypto.randomUUID(),
              role: 'lead' as const,
              content: verdict.message,
              timestamp: Date.now(),
            })
            await deleteQgState(fastify.redis, qgTaskId)
          } else if (verdict?.verdict === 'block') {
            // ── Block ─────────────────────────────────────────────────────────
            await logTaskActivity(fastify, qgTaskId, 'quality_gate.blocked', {
              attempt: qgState.attempt,
              issues: verdict.issues,
            })
            await pushChatMessage(fastify, {
              id: crypto.randomUUID(),
              role: 'lead' as const,
              content: verdict.message,
              timestamp: Date.now(),
            })

            if (qgState.attempt < 2 && verdict.fixRoles.length > 0) {
              // Dispatch fix agents as a new single-wave WaveState
              const newBranchSuffix = Date.now().toString(36)
              const newProposalId = crypto.randomUUID()
              const issueLines = verdict.issues
                .map((i) => `- [${i.severity}] ${i.description}`)
                .join('\n')
              const fixDescription = `${qgState.taskDescription}\n\n## Issues to Fix (from Quality Gate):\n${issueLines}`

              const fixWaveState: WaveState = {
                proposalId: newProposalId,
                waves: [{
                  roles: verdict.fixRoles.map((r) => ({ slug: r.slug, reason: r.brief })),
                  brief: 'Fix issues found by quality gate review',
                }],
                currentWave: 0,
                taskTitle: qgState.taskTitle,
                taskDescription: fixDescription,
                projectId: qgState.projectId,
                baseBranch: qgState.baseBranch,
                branchSuffix: newBranchSuffix,
                createdBy: qgState.createdBy,
                imagePaths: [],
                pendingSessions: [],
                completedSessions: [],
                rootTaskId: qgTaskId,
              }

              const pendingFixSessions: string[] = []
              for (const r of verdict.fixRoles) {
                const roleObj = await findRoleBySlug(fastify, r.slug)
                if (!roleObj) {
                  fastify.log.warn({ slug: r.slug }, 'QG block: skipping unknown fix role')
                  continue
                }
                const workingDir =
                  qgState.projectPaths[r.slug] ??
                  Object.values(qgState.projectPaths)[0] ??
                  '/tmp'
                const fixPrompt = `${fixDescription}\n${buildGitInstructions(qgState.baseBranch, newBranchSuffix)}`
                const result = await dispatchAgent(
                  r.slug,
                  workingDir,
                  fixPrompt,
                  { projectId: qgState.projectId, taskId: null, createdBy: qgState.createdBy },
                  roleObj.systemPrompt ?? undefined,
                )
                if (result.id) {
                  pendingFixSessions.push(result.id)
                  await indexSession(fastify.redis, result.id, newProposalId)
                  await pushChatMessage(fastify, {
                    id: crypto.randomUUID(),
                    role: 'agent' as const,
                    content: `[${r.slug}] Fix agent เริ่มทำงานแล้ว (session ${result.id.slice(0, 8)})`,
                    timestamp: Date.now(),
                    meta: { agentRole: r.slug, sessionId: result.id },
                  })
                }
              }

              if (pendingFixSessions.length > 0) {
                fixWaveState.pendingSessions = pendingFixSessions
                await saveWaveState(fastify.redis, fixWaveState)
                // Increment attempt in QG state (reviewer will read this on next trigger)
                await saveQgState(fastify.redis, { ...qgState, attempt: qgState.attempt + 1 })
              } else {
                // No fix agents dispatched — escalate immediately
                await logTaskActivity(fastify, qgTaskId, 'quality_gate.escalated', {
                  attempt: qgState.attempt,
                  reason: 'no_fix_agents_dispatched',
                })
                await pushChatMessage(fastify, {
                  id: crypto.randomUUID(),
                  role: 'lead' as const,
                  content: 'Quality gate blocked แต่ไม่สามารถ dispatch fix agents ได้ — กรุณาแก้ไขด้วยตนเอง',
                  timestamp: Date.now(),
                })
                await deleteQgState(fastify.redis, qgTaskId)
              }
            } else {
              // Max attempts reached — escalate to user
              await logTaskActivity(fastify, qgTaskId, 'quality_gate.escalated', {
                attempt: qgState.attempt,
                reason: 'max_attempts_reached',
              })
              await pushChatMessage(fastify, {
                id: crypto.randomUUID(),
                role: 'lead' as const,
                content: `Quality gate ล้มเหลวหลัง ${qgState.attempt + 1} ครั้ง — กรุณาแก้ไขปัญหาด้วยตนเองแล้วแจ้งกลับมา`,
                timestamp: Date.now(),
              })
              await deleteQgState(fastify.redis, qgTaskId)
            }
          } else {
            // No valid verdict_json — log warning, treat as passed to avoid infinite loop
            fastify.log.warn({ sessionId: body.sessionId, qgTaskId }, 'QG reviewer returned no valid verdict_json — treating as pass')
            await fastify.db
              .update(tasks)
              .set({ stage: 'done', updatedAt: new Date() })
              .where(eq(tasks.id, qgTaskId))
            await fastify.redis.publish(
              TASKS_CHANNEL,
              JSON.stringify({ type: 'task.stage', taskId: qgTaskId, stage: 'done', projectId: qgState.projectId }),
            )
            await deleteQgState(fastify.redis, qgTaskId)
          }
        }
        return reply.status(200).send({ ok: true })
      }
    } catch (err) {
      fastify.log.warn({ err, sessionId: body.sessionId }, 'Quality gate reviewer handler failed — continuing as regular agent')
    }
    // ── End Quality Gate reviewer check ──────────────────────────────────────

    const { taskId, role, success, outputLog, projectId } = body

    const prUrl = extractPrUrl(outputLog)
    const summary = buildSummary(outputLog)

    // Persist outcome for future context injection (fire-and-forget)
    if (projectId) {
      fastify.db
        .insert(agentOutcomes)
        .values({ projectId, role, summary, prUrl: prUrl ?? null })
        .catch((err: unknown) => fastify.log.warn({ err, projectId, role }, 'Failed to insert agentOutcomes'))
    }

    // When success + prUrl, QG controls the final "done" transition — keep in_progress
    const stage = success ? (prUrl ? 'in_progress' : 'done') : 'in_progress'

    // 1. Update task stage + save output as comment
    if (taskId) {
      await fastify.db
        .update(tasks)
        .set({ stage, githubPrUrl: prUrl ?? null, updatedAt: new Date() })
        .where(eq(tasks.id, taskId))

      const commentBody = [
        `**Agent [${role}] ${success ? 'เสร็จแล้ว ✓' : 'มีข้อผิดพลาด ✕'}**`,
        '',
        summary ? `**สรุป:** ${summary}` : '',
        prUrl ? `**PR:** ${prUrl}` : '',
        '',
        '```',
        outputLog.split('\n').slice(-50).join('\n'),
        '```',
      ].filter(l => l !== undefined).join('\n')

      await fastify.db.insert(taskComments).values({
        taskId,
        body: commentBody,
        source: 'agent',
        authorId: null,
      })

      await fastify.redis.publish(TASKS_CHANNEL, JSON.stringify({ type: 'task.stage', taskId, stage, projectId }))

      // 2. Check parent task — if all subtasks done → mark parent done
      const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
      if (task?.parentTaskId) {
        const [{ value: pendingCount }] = await fastify.db
          .select({ value: count() })
          .from(tasks)
          .where(
            and(
              eq(tasks.parentTaskId, task.parentTaskId),
              ne(tasks.stage, 'done'),
              ne(tasks.id, taskId),
            )
          )
        if (Number(pendingCount) === 0) {
          await fastify.db
            .update(tasks)
            .set({ stage: 'done', updatedAt: new Date() })
            .where(eq(tasks.id, task.parentTaskId))
          await fastify.redis.publish(TASKS_CHANNEL, JSON.stringify({ type: 'task.stage', taskId: task.parentTaskId, stage: 'done', projectId }))
        }
      }
    }

    // 3. Push completion message to Lead chat
    const statusIcon = success ? '✓' : '✕'
    const chatMsg = {
      id: crypto.randomUUID(),
      role: 'agent' as const,
      content: [
        `[${role}] ${statusIcon} ${success ? 'เสร็จแล้ว' : 'มีข้อผิดพลาด'}`,
        summary ? `สรุป: ${summary}` : '',
        prUrl ? `PR: ${prUrl}` : '',
      ].filter(Boolean).join('\n'),
      timestamp: Date.now(),
      meta: {
        agentRole: role,
        prUrl: prUrl ?? undefined,
        success,
      },
    }

    await pushChatMessage(fastify, chatMsg)

    // Wave progression — if this session belongs to a wave, handle the wave logic.
    // Otherwise fall through to the normal single-agent synthesis.
    let handledByWave = false
    try {
      const proposalId = await lookupSessionProposal(fastify.redis, body.sessionId)
      if (proposalId) {
        handledByWave = true
        await removeSessionIndex(fastify.redis, body.sessionId)
        const state = await getWaveState(fastify.redis, proposalId)
        if (state) {
          state.completedSessions.push({
            sessionId: body.sessionId,
            role,
            success,
            summary,
            exitCode: body.exitCode ?? null,
          })
          state.pendingSessions = state.pendingSessions.filter((id) => id !== body.sessionId)

          if (state.pendingSessions.length > 0) {
            // Still waiting for other agents in this wave — just persist updated state
            await updateWaveState(fastify.redis, state)
          } else {
            // All agents in current wave done — evaluate
            const hasNextWave = state.currentWave + 1 < state.waves.length
            const evalResult = await runWaveEvaluation(state)

            // Log wave.completed for root task (if any)
            if (state.rootTaskId) {
              const waveSuccess = state.completedSessions.every((s) => s.success)
              const waveSummary = state.completedSessions.map((s) => `[${s.role}] ${s.summary}`).join('; ')
              await logTaskActivity(fastify, state.rootTaskId, 'wave.completed', {
                waveIndex: state.currentWave,
                success: waveSuccess,
                summary: waveSummary,
              })
            }

            if (!hasNextWave) {
              // Final wave complete — attempt quality gate if any PRs were created
              const prUrls = state.completedSessions
                .map((s) => s.summary.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0])
                .filter((u): u is string => Boolean(u))

              let projectPaths: Record<string, string> = {}
              if (state.projectId) {
                const [proj] = await fastify.db
                  .select()
                  .from(projects)
                  .where(eq(projects.id, state.projectId))
                  .limit(1)
                if (proj) projectPaths = (proj.paths as Record<string, string>) ?? {}
              }

              if (state.rootTaskId && prUrls.length > 0) {
                // Hand off to Quality Gate — reviewer will move task to "done" on pass
                await logTaskActivity(fastify, state.rootTaskId, 'wave.done', {
                  totalWaves: state.waves.length,
                })
                await triggerQualityGate(fastify, state.rootTaskId, prUrls, projectPaths, {
                  projectId: state.projectId,
                  baseBranch: state.baseBranch,
                  branchSuffix: state.branchSuffix,
                  createdBy: state.createdBy,
                  taskTitle: state.taskTitle,
                  taskDescription: state.taskDescription,
                })
              } else {
                // No PRs or no rootTaskId — existing behavior
                await pushChatMessage(fastify, {
                  id: crypto.randomUUID(),
                  role: 'lead' as const,
                  content: evalResult.message,
                  timestamp: Date.now(),
                })
                if (state.rootTaskId) {
                  await logTaskActivity(fastify, state.rootTaskId, 'wave.done', {
                    totalWaves: state.waves.length,
                  })
                }
              }
              await deleteWaveState(fastify.redis, proposalId)
            } else if (evalResult.ask) {
              // Lead unsure — surface to user, stop auto-progression
              await pushChatMessage(fastify, {
                id: crypto.randomUUID(),
                role: 'lead' as const,
                content: evalResult.message,
                timestamp: Date.now(),
              })
              await deleteWaveState(fastify.redis, proposalId)
            } else if (evalResult.proceed) {
              // Auto-proceed: push status message then dispatch next wave
              await pushChatMessage(fastify, {
                id: crypto.randomUUID(),
                role: 'lead' as const,
                content: evalResult.message,
                timestamp: Date.now(),
              })
              const nextWaveIndex = state.currentWave + 1
              const newPending = await dispatchNextWave(fastify, state, nextWaveIndex)
              state.currentWave = nextWaveIndex
              state.pendingSessions = newPending
              state.completedSessions = []   // fresh slate for next wave
              if (state.rootTaskId) {
                await logTaskActivity(fastify, state.rootTaskId, 'wave.dispatched', {
                  waveIndex: nextWaveIndex,
                  roles: state.waves[nextWaveIndex]?.roles.map((r) => r.slug) ?? [],
                })
              }
              if (newPending.length > 0) {
                await updateWaveState(fastify.redis, state)
              } else {
                await deleteWaveState(fastify.redis, proposalId)
              }
            } else {
              // proceed: false, ask: false — treat as done
              await pushChatMessage(fastify, {
                id: crypto.randomUUID(),
                role: 'lead' as const,
                content: evalResult.message,
                timestamp: Date.now(),
              })
              await deleteWaveState(fastify.redis, proposalId)
            }
          }
        }
      }
    } catch (err) {
      fastify.log.warn({ err, sessionId: body.sessionId }, 'Wave progression failed — falling through to synthesis')
      handledByWave = false
    }

    // Single-agent completion — trigger QG if PR was created, otherwise synthesize
    if (!handledByWave) {
      if (success && prUrl && taskId) {
        // Load task + project to get paths for QG
        void (async () => {
          try {
            const [task] = await fastify.db
              .select()
              .from(tasks)
              .where(eq(tasks.id, taskId))
              .limit(1)
            if (!task) return

            let projectPaths: Record<string, string> = {}
            let baseBranch = 'main'
            if (task.projectId) {
              const [proj] = await fastify.db
                .select()
                .from(projects)
                .where(eq(projects.id, task.projectId))
                .limit(1)
              if (proj) {
                projectPaths = (proj.paths as Record<string, string>) ?? {}
                baseBranch = proj.baseBranch ?? 'main'
              }
            }

            await triggerQualityGate(fastify, taskId, [prUrl], projectPaths, {
              projectId: task.projectId ?? null,
              baseBranch,
              branchSuffix: Date.now().toString(36),
              createdBy: 'system',
              taskTitle: task.title ?? '',
              taskDescription: task.description ?? '',
            })
          } catch (err) {
            fastify.log.warn({ err, taskId }, 'Single-agent QG trigger failed — skipping')
          }
        })()
      } else {
        void synthesizeAfterCompletion(fastify, {
          agentRole: role,
          success,
          summary,
          prUrl,
        })
      }
    }

    return reply.status(200).send({ ok: true })
  })
}

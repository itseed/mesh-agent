import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, desc, and } from 'drizzle-orm'
import { tasks, taskComments, taskActivities, taskAttachments, projects, agentRoles, agentSessions } from '@meshagent/shared'
import { logAudit } from '../lib/audit.js'
import { analyzeTask, type AnalyzePlan } from '../lib/analyze.js'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { dispatchAgent, buildGitInstructions } from '../lib/dispatch.js'
import { findRoleBySlug } from '../lib/roles.js'
import { runLeadTask } from '../lib/lead-task.js'
import { saveWaveState, indexSession, type WaveState } from '../lib/wave-store.js'
import { buildContextBlock } from '../lib/context-builder.js'
import { env } from '../env.js'

const TASKS_CHANNEL = 'tasks:events'

async function publishTaskEvent(fastify: FastifyInstance, type: string, payload: Record<string, unknown>) {
  await fastify.redis.publish(TASKS_CHANNEL, JSON.stringify({ type, ...payload }))
}

const STAGES = ['backlog', 'in_progress', 'review', 'done'] as const
const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const createTaskSchema = z.object({
  title: z.string().min(1).max(512),
  description: z.string().max(64 * 1024).optional(),
  stage: z.enum(STAGES).default('backlog'),
  status: z.enum(STATUSES).default('open'),
  priority: z.enum(PRIORITIES).default('medium'),
  agentRole: z
    .string()
    .max(64)
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().optional(),
  githubPrUrl: z.string().url().max(2048).optional(),
})

const updateTaskSchema = z.object({
  title: z.string().min(1).max(512).optional(),
  description: z.string().max(64 * 1024).optional(),
  stage: z.enum(STAGES).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  agentRole: z.string().max(64).regex(/^[a-z0-9_-]+$/).optional().nullable(),
  projectId: z.string().optional().nullable(),
  parentTaskId: z.string().optional().nullable(),
  githubPrUrl: z.string().url().max(2048).optional().nullable(),
})

const stageSchema = z.object({ stage: z.enum(STAGES) })

const startSchema = z.object({
  cli: z.enum(['claude', 'gemini', 'cursor']).optional(),
  executionMode: z.enum(['cloud', 'local']).optional().default('cloud'),
})

const createCommentSchema = z.object({
  body: z.string().min(1).max(64 * 1024),
})

export async function taskRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  fastify.get('/tasks', { preHandler }, async (request) => {
    const { projectId, stage, status } = request.query as {
      projectId?: string
      stage?: string
      status?: string
    }
    let query = fastify.db.select().from(tasks).$dynamic()
    if (projectId) query = query.where(eq(tasks.projectId, projectId))
    if (stage) query = query.where(eq(tasks.stage, stage as typeof STAGES[number]))
    if (status) query = query.where(eq(tasks.status, status as typeof STATUSES[number]))
    return query.orderBy(tasks.createdAt)
  })

  fastify.get('/tasks/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) return reply.status(404).send({ error: 'Task not found' })
    return task
  })

  fastify.post('/tasks', { preHandler }, async (request, reply) => {
    const body = createTaskSchema.parse(request.body)
    const [task] = await fastify.db.insert(tasks).values(body).returning()
    await logAudit(fastify, request, { action: 'task.created', target: task.id })
    await publishTaskEvent(fastify, 'task.created', { taskId: task.id, projectId: task.projectId })
    reply.status(201)
    return task
  })

  fastify.patch('/tasks/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateTaskSchema.parse(request.body)
    const [task] = await fastify.db
      .update(tasks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
    if (!task) return reply.status(404).send({ error: 'Task not found' })
    await logAudit(fastify, request, { action: 'task.updated', target: id, metadata: body as Record<string, unknown> })
    await publishTaskEvent(fastify, 'task.updated', { taskId: id, projectId: task.projectId, stage: task.stage })
    return task
  })

  fastify.patch('/tasks/:id/stage', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { stage } = stageSchema.parse(request.body)
    const [task] = await fastify.db
      .update(tasks)
      .set({ stage, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
    if (!task) return reply.status(404).send({ error: 'Task not found' })
    await logAudit(fastify, request, {
      action: 'task.stage.updated',
      target: id,
      metadata: { stage },
    })
    await publishTaskEvent(fastify, 'task.stage', { taskId: id, projectId: task.projectId, stage })
    return task
  })

  fastify.delete('/tasks/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await fastify.db.delete(tasks).where(eq(tasks.id, id)).returning()
    if (result.length === 0) return reply.status(404).send({ error: 'Task not found' })
    await logAudit(fastify, request, { action: 'task.deleted', target: id })
    await publishTaskEvent(fastify, 'task.deleted', { taskId: id })
    reply.status(204).send()
  })

  // Fix selected review issues → create subtasks + dispatch agents
  const fixIssuesSchema = z.object({
    issues: z.array(z.object({
      title: z.string().min(1).max(512),
      severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
      role: z.string().optional(),
    })).min(1).max(20),
  })

  fastify.post('/tasks/:id/fix-issues', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) return reply.status(404).send({ error: 'Task not found' })

    const { issues } = fixIssuesSchema.parse(request.body)
    const userId = (request.user as { id: string }).id

    let baseBranch = 'main'
    let projectPaths: Record<string, string> = {}
    let projectWorkspacePath: string | null = null
    let project: typeof projects.$inferSelect | null = null
    if (task.projectId) {
      const [proj] = await fastify.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      if (proj) {
        project = proj
        baseBranch = proj.baseBranch ?? 'main'
        projectPaths = (proj.paths as Record<string, string>) ?? {}
        projectWorkspacePath = proj.workspacePath ?? null
      }
    }

    const branchSuffix = Date.now().toString(36)
    const gitInstructions = buildGitInstructions(baseBranch, branchSuffix)
    const fallbackDir = Object.values(projectPaths)[0] ?? '/tmp'

    const created = []
    for (const issue of issues) {
      const role = issue.role ?? 'backend'

      const [subtask] = await fastify.db.insert(tasks).values({
        title: `[Fix] ${issue.title}`,
        description: `แก้ไข ${issue.severity.toUpperCase()} issue จาก code review: ${issue.title}\n\nTask เดิม: ${task.title}`,
        stage: 'in_progress',
        priority: issue.severity === 'critical' ? 'urgent' : issue.severity === 'high' ? 'high' : 'medium',
        agentRole: role,
        projectId: task.projectId ?? null,
        parentTaskId: id,
      }).returning()

      const repoSlug = project?.githubRepos?.[0] ?? null
      const repoUrl = repoSlug ? `https://github.com/${repoSlug}.git` : null
      const repoName = repoSlug?.split('/')[1] ?? 'repo'
      const agentWorkingDir = repoUrl && project
        ? path.join(env.REPOS_BASE_DIR, project.id, repoName)
        : (projectPaths[role] ?? fallbackDir)

      const prompt = `แก้ไข code issue ที่พบจาก review:

**Issue:** ${issue.title}
**Severity:** ${issue.severity.toUpperCase()}
**Context:** ${task.title}${task.description ? `\n${task.description}` : ''}
${gitInstructions}`

      const [roleRow] = await fastify.db.select().from(agentRoles).where(eq(agentRoles.slug, role)).limit(1)

      await dispatchAgent(role, agentWorkingDir, prompt, {
        projectId: task.projectId ?? null,
        taskId: subtask.id,
        createdBy: userId,
      }, roleRow?.systemPrompt ?? undefined, repoUrl ?? undefined)

      await publishTaskEvent(fastify, 'task.created', { taskId: subtask.id, projectId: task.projectId })
      created.push(subtask)
    }

    reply.status(201)
    return { created }
  })

  // Subtasks
  fastify.post('/tasks/:id/subtasks', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [parent] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!parent) return reply.status(404).send({ error: 'Task not found' })
    const body = createTaskSchema.parse({ ...(request.body as object), parentTaskId: id })
    const [subtask] = await fastify.db.insert(tasks).values(body).returning()
    await logAudit(fastify, request, { action: 'task.subtask.created', target: subtask.id, metadata: { parentTaskId: id } })
    reply.status(201)
    return subtask
  })

  // Comments
  fastify.get('/tasks/:id/comments', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const rows = await fastify.db
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, id))
      .orderBy(taskComments.createdAt)
    return rows
  })

  fastify.post('/tasks/:id/comments', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) return reply.status(404).send({ error: 'Task not found' })
    const { body: commentBody } = createCommentSchema.parse(request.body)
    const user = (request as any).user as { id?: string } | undefined
    const [comment] = await fastify.db
      .insert(taskComments)
      .values({ taskId: id, body: commentBody, authorId: user?.id ?? null })
      .returning()
    await fastify.db.insert(taskActivities).values({
      taskId: id,
      actorId: user?.id ?? null,
      type: 'comment.added',
      payload: { commentId: comment.id },
    })
    reply.status(201)
    return comment
  })

  // Activities
  fastify.get('/tasks/:id/activities', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const rows = await fastify.db
      .select()
      .from(taskActivities)
      .where(eq(taskActivities.taskId, id))
      .orderBy(taskActivities.createdAt)
    return rows
  })

  // Attachments — presigned-URL flow: client POSTs metadata → gets back a presigned PUT URL
  const attachmentInitSchema = z.object({
    fileName: z.string().min(1).max(512),
    fileSize: z.number().int().positive().max(100 * 1024 * 1024),
    mimeType: z.string().max(128),
  })

  fastify.post('/tasks/:id/attachments', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) return reply.status(404).send({ error: 'Task not found' })

    if (!fastify.minio) {
      return reply.status(503).send({ error: 'File storage not configured' })
    }

    const { fileName, fileSize, mimeType } = attachmentInitSchema.parse(request.body)
    const storageKey = `tasks/${id}/${crypto.randomUUID()}-${fileName}`

    const uploadUrl = await fastify.minio.presignedPutObject(fastify.minioBucket, storageKey, 3600)

    const user = (request as any).user as { id?: string } | undefined
    const [attachment] = await fastify.db
      .insert(taskAttachments)
      .values({
        taskId: id,
        fileName,
        fileSize,
        mimeType,
        storageKey,
        uploadedBy: user?.id ?? null,
      })
      .returning()

    await fastify.db.insert(taskActivities).values({
      taskId: id,
      actorId: user?.id ?? null,
      type: 'attachment.added',
      payload: { attachmentId: attachment.id, fileName },
    })

    reply.status(201)
    return { ...attachment, uploadUrl }
  })

  fastify.get('/tasks/:id/attachments', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return fastify.db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, id))
      .orderBy(taskAttachments.createdAt)
  })

  fastify.get('/tasks/:id/attachments/:attachmentId/url', { preHandler }, async (request, reply) => {
    const { id, attachmentId } = request.params as { id: string; attachmentId: string }
    const [att] = await fastify.db
      .select()
      .from(taskAttachments)
      .where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.taskId, id)))
      .limit(1)
    if (!att) return reply.status(404).send({ error: 'Attachment not found' })

    if (!fastify.minio) return reply.status(503).send({ error: 'Storage not configured' })

    try {
      const url = await fastify.minio.presignedGetObject(fastify.minioBucket, att.storageKey, 3600)
      return { url }
    } catch {
      return reply.status(503).send({ error: 'Storage not configured' })
    }
  })

  // POST /tasks/:id/analyze — trigger AI analysis
  fastify.post('/tasks/:id/analyze', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) return reply.status(404).send({ error: 'Task not found' })

    await fastify.db.update(tasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(tasks.id, id))

    try {
      const plan = await analyzeTask(task.title, task.description)

      const [comment] = await fastify.db.insert(taskComments).values({
        taskId: id,
        source: 'lead',
        body: JSON.stringify(plan),
      }).returning()

      await fastify.db.update(tasks).set({ status: 'open', updatedAt: new Date() }).where(eq(tasks.id, id))

      await fastify.db.insert(taskActivities).values({
        taskId: id,
        type: 'analyzed',
        payload: { commentId: comment.id, subtaskCount: plan.subtasks.length },
      })

      reply.status(201)
      return { comment, plan }
    } catch (err: any) {
      await fastify.db.update(tasks).set({ status: 'open', updatedAt: new Date() }).where(eq(tasks.id, id))
      return reply.status(500).send({ error: err.message ?? 'Analysis failed' })
    }
  })

  // POST /tasks/:id/approve — approve the plan and create subtasks
  fastify.post('/tasks/:id/approve', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) return reply.status(404).send({ error: 'Task not found' })

    const [planComment] = await fastify.db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.taskId, id), eq(taskComments.source, 'lead')))
      .orderBy(desc(taskComments.createdAt))
      .limit(1)

    if (!planComment) return reply.status(400).send({ error: 'No plan to approve — run analyze first' })

    let plan: AnalyzePlan
    try {
      plan = JSON.parse(planComment.body)
    } catch {
      return reply.status(400).send({ error: 'Plan comment is not valid JSON' })
    }

    const subtasks = await Promise.all(
      plan.subtasks.map((s) =>
        fastify.db.insert(tasks).values({
          title: s.title,
          description: s.description,
          agentRole: s.agentRole,
          priority: s.priority ?? 'medium',
          parentTaskId: id,
          projectId: task.projectId,
          stage: 'backlog',
          status: 'open',
        }).returning().then((r) => r[0])
      )
    )

    await fastify.db.update(tasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(tasks.id, id))

    await fastify.db.insert(taskActivities).values({
      taskId: id,
      type: 'approved',
      payload: { subtaskIds: subtasks.map((s) => s.id) },
    })

    await logAudit(fastify, request, { action: 'task.approved', target: id })

    // Dispatch agents for each subtask
    const approveBody = z.object({ executionMode: z.enum(['cloud', 'local']).optional().default('cloud') }).parse(request.body ?? {})
    const executionMode = approveBody.executionMode

    if (task.projectId) {
      const [project] = await fastify.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      if (project) {
        const baseBranch = (project as any).baseBranch ?? 'main'
        const branchSuffix = Date.now().toString(36)
        const gitInstructions = buildGitInstructions(baseBranch, branchSuffix)
        const paths = (project.paths ?? {}) as Record<string, string>

        await Promise.all(subtasks.map(async (subtask) => {
          if (!subtask) return
          const role = subtask.agentRole ?? 'reviewer'

          let workingDir: string
          let repoUrl: string | undefined
          if (executionMode === 'cloud' && project.githubRepos?.length) {
            const repoSlug = project.githubRepos[0] as string
            const repoName = repoSlug.split('/')[1]
            repoUrl = `https://github.com/${repoSlug}.git`
            workingDir = path.join(env.REPOS_BASE_DIR, project.id, repoName)
          } else {
            workingDir = paths[role] ?? Object.values(paths)[0] ?? '/tmp'
          }

          const prompt = [
            `## Task Context`,
            `Task: ${task.title}`,
            task.description ? `Description: ${task.description}` : '',
            ``,
            `## Your Subtask`,
            subtask.title,
            subtask.description ?? '',
            gitInstructions,
          ].filter(Boolean).join('\n')

          const result = await dispatchAgent(role, workingDir, prompt, {
            projectId: task.projectId,
            taskId: subtask.id,
            createdBy: null,
            executionMode,
          }, undefined, repoUrl)

          if (result.id) {
            await fastify.db.update(tasks).set({ stage: 'in_progress' }).where(eq(tasks.id, subtask.id))
          }
        }))
      }
    }

    return { task: { ...task, status: 'in_progress' }, subtasks }
  })

  fastify.post('/tasks/:id/start', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = (request.user as { id: string }).id

    const startBody = startSchema.parse(request.body ?? {})

    // 1. Load task
    const [task] = await fastify.db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) return reply.status(404).send({ error: 'Task not found' })
    if (task.stage !== 'backlog') {
      return reply.status(409).send({ error: `Task is already ${task.stage} — cannot start again` })
    }
    if (!fastify.minio) {
      return reply.status(503).send({ error: 'MinIO not configured — file attachments unavailable' })
    }

    // 2. Load attachments
    const attachments = await fastify.db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, id))

    // 3. Download attachments to local tmp dir
    const tmpDir = `/tmp/mesh-agent/tasks/${id}`
    await mkdir(tmpDir, { recursive: true })
    const localFilePaths: string[] = []

    for (const att of attachments) {
      const localPath = path.join(tmpDir, att.fileName)
      try {
        const url = await fastify.minio.presignedGetObject(fastify.minioBucket, att.storageKey, 300)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`MinIO returned ${res.status}`)
        await writeFile(localPath, Buffer.from(await res.arrayBuffer()))
        localFilePaths.push(localPath)
      } catch (err) {
        fastify.log.warn({ err, storageKey: att.storageKey }, 'Failed to download attachment — skipping')
      }
    }

    // 4. Load project paths
    let projectPaths: Record<string, string> = {}
    let baseBranch = 'main'
    if (task.projectId) {
      const [proj] = await fastify.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      if (proj) {
        projectPaths = (proj.paths as Record<string, string>) ?? {}
        baseBranch = proj.baseBranch ?? 'main'
      }
    }

    // 4b. If task already has approved subtasks in backlog, dispatch them directly
    const existingSubtasks = await fastify.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, id), eq(tasks.stage, 'backlog')))

    if (existingSubtasks.length > 0) {
      const executionMode = startBody.executionMode ?? 'cloud'
      const branchSuffix = Date.now().toString(36)
      const gitInstructions = buildGitInstructions(baseBranch, branchSuffix)
      const projectCtxBlock = await buildContextBlock(task.projectId ?? null, fastify)

      // Load project for repo info (cloud mode needs githubRepos)
      let projectData: any = null
      if (task.projectId) {
        const [proj] = await fastify.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
        projectData = proj
      }

      const dispatched: string[] = []
      for (const subtask of existingSubtasks) {
        const role = subtask.agentRole ?? 'reviewer'

        let agentWorkingDir: string
        let repoUrl: string | undefined
        if (executionMode === 'cloud' && projectData?.githubRepos?.length) {
          const repoSlug = projectData.githubRepos[0] as string
          const repoName = repoSlug.split('/')[1]
          repoUrl = `https://github.com/${repoSlug}.git`
          agentWorkingDir = path.join(env.REPOS_BASE_DIR, task.projectId!, repoName)
        } else {
          agentWorkingDir = projectPaths[role] ?? Object.values(projectPaths)[0] ?? '/tmp'
        }

        const fullPrompt = [
          projectCtxBlock ? projectCtxBlock + '\n' : '',
          `## Task Context`,
          `Task: ${task.title}`,
          task.description ? `Description: ${task.description}` : '',
          ``,
          `## Your Subtask`,
          subtask.title,
          subtask.description ?? '',
          gitInstructions,
        ].filter(Boolean).join('\n')

        const result = await dispatchAgent(role, agentWorkingDir, fullPrompt, {
          projectId: task.projectId ?? null,
          taskId: subtask.id,
          createdBy: userId,
          cliProvider: startBody.cli,
          executionMode,
          userId,
          db: fastify.db,
        }, undefined, repoUrl)

        if (result.id) {
          dispatched.push(result.id)
          await fastify.db.update(tasks).set({ stage: 'in_progress', updatedAt: new Date() }).where(eq(tasks.id, subtask.id))
          await indexSession(fastify.redis, result.id, id)
        } else {
          await fastify.db.update(tasks).set({ status: 'blocked', updatedAt: new Date() }).where(eq(tasks.id, subtask.id))
        }
      }

      await fastify.db.update(tasks).set({ stage: 'in_progress', updatedAt: new Date() }).where(eq(tasks.id, id))

      if (dispatched.length === 0) {
        return reply.status(500).send({ error: 'No agents could be dispatched' })
      }

      return { ok: true, waveCount: 1, pendingSessions: dispatched }
    }

    // 5. Run Lead to plan waves
    let leadResult: Awaited<ReturnType<typeof runLeadTask>>
    try {
      leadResult = await runLeadTask(task, localFilePaths, projectPaths)
    } catch (err: any) {
      fastify.log.error({ err, taskId: id }, 'Lead task planning failed')
      return reply.status(502).send({ error: `Lead planning failed: ${err?.message ?? 'unknown'}` })
    }

    const { waves, taskBrief } = leadResult

    // 6. Log: lead.wave.planned
    await fastify.db.insert(taskActivities).values({
      taskId: id,
      actorId: null,
      type: 'lead.wave.planned',
      payload: {
        waveCount: waves.length,
        waves: waves.map((w) => ({ roles: w.roles.map((r) => r.slug), brief: w.brief })),
      },
    })

    // 7. Dispatch Wave 0
    const branchSuffix = Date.now().toString(36)
    const gitInstructions = buildGitInstructions(baseBranch, branchSuffix)
    const imageBlock = localFilePaths.length > 0
      ? `\n\n## Attached requirement files\nUse the Read tool on each path before starting work:\n${localFilePaths.map((p) => `- ${p}`).join('\n')}`
      : ''
    const projectCtxBlock = await buildContextBlock(task.projectId ?? null, fastify)
    const fullPrompt = `${projectCtxBlock ? projectCtxBlock + '\n\n' : ''}${taskBrief.description}${imageBlock}${gitInstructions}`

    const wave0 = waves[0]
    const pendingSessions: string[] = []

    for (const r of wave0.roles) {
      const role = await findRoleBySlug(fastify, r.slug)
      if (!role) {
        fastify.log.warn({ slug: r.slug }, 'start: skipping unknown role')
        continue
      }

      const agentWorkingDir = projectPaths[r.slug] ?? Object.values(projectPaths)[0] ?? '/tmp'

      const [agentTask] = await fastify.db
        .insert(tasks)
        .values({
          title: taskBrief.title,
          description: taskBrief.description,
          stage: 'in_progress',
          agentRole: r.slug,
          projectId: task.projectId ?? null,
          parentTaskId: id,
        })
        .returning()

      const result = await dispatchAgent(r.slug, agentWorkingDir, fullPrompt, {
        projectId: task.projectId ?? null,
        taskId: agentTask?.id ?? null,
        createdBy: userId,
        cliProvider: startBody.cli,
      }, role?.systemPrompt ?? undefined)

      if (!result.id && agentTask?.id) {
        await fastify.db
          .update(tasks)
          .set({ stage: 'backlog', status: 'blocked', updatedAt: new Date() })
          .where(eq(tasks.id, agentTask.id))
      }

      if (result.id) {
        pendingSessions.push(result.id)
        await indexSession(fastify.redis, result.id, id)
        if (startBody.cli) {
          fastify.db
            .update(agentSessions)
            .set({ cliProvider: startBody.cli })
            .where(eq(agentSessions.id, result.id))
            .catch((err: unknown) => fastify.log.warn({ err, sessionId: result.id }, 'Failed to save cliProvider'))
        }
      }
    }

    if (pendingSessions.length === 0) {
      return reply.status(500).send({ error: 'No agents could be dispatched' })
    }

    // 8. Log: wave.dispatched (wave 0)
    await fastify.db.insert(taskActivities).values({
      taskId: id,
      actorId: null,
      type: 'wave.dispatched',
      payload: { waveIndex: 0, roles: wave0.roles.map((r) => r.slug) },
    })

    // 9. Save WaveState (only if multiple waves)
    if (waves.length > 1) {
      const waveState: WaveState = {
        proposalId: id,
        waves,
        currentWave: 0,
        taskTitle: taskBrief.title,
        taskDescription: taskBrief.description,
        projectId: task.projectId ?? null,
        baseBranch,
        branchSuffix,
        createdBy: userId,
        imagePaths: localFilePaths,
        pendingSessions,
        completedSessions: [],
        rootTaskId: id,
      }
      await saveWaveState(fastify.redis, waveState)
    }

    // 10. Update task stage
    await fastify.db
      .update(tasks)
      .set({ stage: 'in_progress', updatedAt: new Date() })
      .where(eq(tasks.id, id))

    await fastify.redis.publish(
      'tasks:events',
      JSON.stringify({ type: 'task.stage', taskId: id, stage: 'in_progress', projectId: task.projectId ?? null }),
    )

    return { ok: true, waveCount: waves.length, pendingSessions }
  })
}

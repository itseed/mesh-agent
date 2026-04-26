import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, desc, and } from 'drizzle-orm'
import { tasks, taskComments, taskActivities, taskAttachments, projects } from '@meshagent/shared'
import { logAudit } from '../lib/audit.js'
import { analyzeTask, type AnalyzePlan } from '../lib/analyze.js'
import { dispatchAgent, buildGitInstructions } from '../lib/dispatch.js'

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
    if (task.projectId) {
      const [project] = await fastify.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      if (project) {
        const baseBranch = (project as any).baseBranch ?? 'main'
        const branchSuffix = Date.now().toString(36)
        const gitInstructions = buildGitInstructions(baseBranch, branchSuffix)

        await Promise.all(subtasks.map(async (subtask) => {
          if (!subtask) return
          const role = subtask.agentRole ?? 'reviewer'
          const paths = (project.paths ?? {}) as Record<string, string>
          const workingDir = paths[role] ?? Object.values(paths)[0] ?? '/tmp'
          const prompt = `${subtask.title}\n\n${subtask.description ?? ''}${gitInstructions}`

          const result = await dispatchAgent(role, workingDir, prompt, {
            projectId: task.projectId,
            taskId: subtask.id,
            createdBy: null,
          })

          if (result.id) {
            await fastify.db.update(tasks).set({ stage: 'in_progress' }).where(eq(tasks.id, subtask.id))
          }
        }))
      }
    }

    return { task: { ...task, status: 'in_progress' }, subtasks }
  })
}

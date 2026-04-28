import { pgTable, text, timestamp, boolean, jsonb, integer, index, serial } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull().default('member'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
})

export const projects = pgTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  paths: jsonb('paths').notNull().$type<Record<string, string>>().default({}),
  githubRepos: jsonb('github_repos').notNull().$type<string[]>().default([]),
  baseBranch: text('base_branch').notNull().default('main'),
  workspacePath: text('workspace_path'),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    description: text('description'),
    stage: text('stage', {
      enum: ['backlog', 'in_progress', 'review', 'done'],
    }).notNull().default('backlog'),
    status: text('status', {
      enum: ['open', 'in_progress', 'blocked', 'done', 'cancelled'],
    }).notNull().default('open'),
    priority: text('priority', {
      enum: ['low', 'medium', 'high', 'urgent'],
    }).notNull().default('medium'),
    agentRole: text('agent_role'),
    projectId: text('project_id').references(() => projects.id),
    parentTaskId: text('parent_task_id'),
    githubPrUrl: text('github_pr_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('tasks_project_idx').on(t.projectId),
    stageIdx: index('tasks_stage_idx').on(t.stage),
    parentIdx: index('tasks_parent_idx').on(t.parentTaskId),
  }),
)

export const agentRoles = pgTable('agent_roles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt'),
  keywords: jsonb('keywords').notNull().$type<string[]>().default([]),
  isBuiltin: boolean('is_builtin').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const cliProviders = pgTable('cli_providers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider', { enum: ['claude', 'gemini', 'cursor'] }).notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    role: text('role').notNull(),
    workingDir: text('working_dir').notNull(),
    prompt: text('prompt').notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'errored', 'killed'],
    }).notNull().default('pending'),
    projectId: text('project_id').references(() => projects.id),
    taskId: text('task_id'),
    cliProvider: text('cli_provider'),
    pid: integer('pid'),
    exitCode: integer('exit_code'),
    error: text('error'),
    outputLog: text('output_log'),
    createdBy: text('created_by'),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('agent_sessions_status_idx').on(t.status),
    createdAtIdx: index('agent_sessions_created_at_idx').on(t.createdAt),
  }),
)

export const agentMetrics = pgTable(
  'agent_metrics',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    durationMs: integer('duration_ms'),
    outputBytes: integer('output_bytes').notNull().default(0),
    success: boolean('success').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    roleIdx: index('agent_metrics_role_idx').on(t.role),
    createdAtIdx: index('agent_metrics_created_at_idx').on(t.createdAt),
  }),
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id'),
    action: text('action').notNull(),
    target: text('target'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('audit_log_user_idx').on(t.userId),
    createdAtIdx: index('audit_log_created_at_idx').on(t.createdAt),
  }),
)

export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedBy: text('uploaded_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('task_attachments_task_idx').on(t.taskId),
  }),
)

export const taskComments = pgTable(
  'task_comments',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id'),
    source: text('source', { enum: ['user', 'lead', 'agent'] }).notNull().default('user'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('task_comments_task_idx').on(t.taskId),
  }),
)

export const taskActivities = pgTable(
  'task_activities',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: text('actor_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('task_activities_task_idx').on(t.taskId),
    createdAtIdx: index('task_activities_created_at_idx').on(t.createdAt),
  }),
)

export const projectContext = pgTable('project_context', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  brief: text('brief').notNull().default(''),
  autoContext: text('auto_context').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const agentOutcomes = pgTable(
  'agent_outcomes',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    summary: text('summary').notNull(),
    prUrl: text('pr_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    projectCreatedIdx: index('agent_outcomes_project_created_idx').on(t.projectId, t.createdAt),
  }),
)

import { pgTable, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core'

export const projects = pgTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  paths: jsonb('paths').notNull().$type<Record<string, string>>().default({}),
  githubRepos: jsonb('github_repos').notNull().$type<string[]>().default([]),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  description: text('description'),
  stage: text('stage', {
    enum: ['backlog', 'in_progress', 'review', 'done'],
  }).notNull().default('backlog'),
  agentRole: text('agent_role', {
    enum: ['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer'],
  }),
  projectId: text('project_id').references(() => projects.id),
  githubPrUrl: text('github_pr_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

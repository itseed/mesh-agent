import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import * as schema from '@meshagent/shared';
import { eq, sql } from 'drizzle-orm';

config({ path: resolve(process.cwd(), '../../.env') });

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

const AUTH_EMAIL = process.env.AUTH_EMAIL ?? 'admin@meshagent.dev';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? 'password123';

async function ensureAdminUser(): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  if (count > 0) {
    console.log('  Admin user already exists — skipping');
    return;
  }
  const passwordHash = await bcrypt.hash(AUTH_PASSWORD, 12);
  await db.insert(schema.users).values({
    email: AUTH_EMAIL.toLowerCase().trim(),
    passwordHash,
    role: 'admin',
    isActive: true,
  });
  console.log(`  Created admin user: ${AUTH_EMAIL}`);
}

async function seedE2E() {
  console.log('🌱 Seeding E2E test data...');

  // 1. Admin user
  await ensureAdminUser();

  // 2. E2E project
  const [inserted] = await db
    .insert(schema.projects)
    .values({
      name: 'E2E Test Project',
      paths: { web: '/apps/web', api: '/apps/api' },
      githubRepos: [],
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const project =
    inserted ??
    (
      await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.name, 'E2E Test Project'))
    )[0];

  if (!project) throw new Error('Failed to create or fetch E2E Test Project');
  console.log(`  Project: ${project.name} (${project.id})`);

  // 3. Tasks — one per required stage, backlog gets 2
  const taskRows = await db
    .insert(schema.tasks)
    .values([
      {
        title: 'E2E Backlog Task 1',
        description: 'First backlog item for E2E testing',
        stage: 'backlog' as const,
        status: 'open' as const,
        priority: 'medium' as const,
        agentRole: 'frontend',
        projectId: project.id,
      },
      {
        title: 'E2E Backlog Task 2',
        description: 'Second backlog item for E2E testing',
        stage: 'backlog' as const,
        status: 'open' as const,
        priority: 'low' as const,
        agentRole: 'backend',
        projectId: project.id,
      },
      {
        title: 'E2E In-Progress Task',
        description: 'Task currently being worked on',
        stage: 'in_progress' as const,
        status: 'in_progress' as const,
        priority: 'high' as const,
        agentRole: 'frontend',
        projectId: project.id,
      },
      {
        title: 'E2E Review Task',
        description: 'Task awaiting review',
        stage: 'review' as const,
        status: 'open' as const,
        priority: 'medium' as const,
        agentRole: 'reviewer',
        projectId: project.id,
      },
      {
        title: 'E2E Done Task',
        description: 'Completed task with review issues for FixIssuesPanel testing',
        stage: 'done' as const,
        status: 'done' as const,
        priority: 'high' as const,
        agentRole: 'backend',
        projectId: project.id,
      },
    ])
    .returning();

  console.log(`  Tasks: ${taskRows.length} created`);

  const inProgressTask = taskRows[2];
  const doneTask = taskRows[4];

  // 4. Agent comment with review issues on the done task (for FixIssuesPanel)
  await db.insert(schema.taskComments).values({
    taskId: doneTask.id,
    source: 'agent' as const,
    body: '## Issues Found\n1. Fix button alignment\n2. Add error handling',
  });
  console.log(`  Comment: review issues added to done task`);

  // 5. Subtasks for the in-progress task
  await db.insert(schema.tasks).values([
    {
      title: 'E2E Subtask 1 — Set up component scaffold',
      stage: 'done' as const,
      status: 'done' as const,
      priority: 'high' as const,
      agentRole: 'frontend',
      parentTaskId: inProgressTask.id,
      projectId: project.id,
    },
    {
      title: 'E2E Subtask 2 — Implement core logic',
      stage: 'in_progress' as const,
      status: 'in_progress' as const,
      priority: 'high' as const,
      agentRole: 'frontend',
      parentTaskId: inProgressTask.id,
      projectId: project.id,
    },
    {
      title: 'E2E Subtask 3 — Write unit tests',
      stage: 'backlog' as const,
      status: 'open' as const,
      priority: 'medium' as const,
      agentRole: 'qa',
      parentTaskId: inProgressTask.id,
      projectId: project.id,
    },
  ]);
  console.log(`  Subtasks: 3 created for in-progress task`);

  console.log('\n✅ E2E seed complete!');
  console.log(`   Project: "${project.name}"`);
  console.log(
    `   Tasks: backlog×2, in_progress×1, review×1, done×1 — subtasks: 3 on in-progress task`,
  );
  console.log(`   Done task has agent comment with review issues for FixIssuesPanel`);

  await client.end();
}

seedE2E().catch((e) => {
  console.error(e);
  process.exit(1);
});

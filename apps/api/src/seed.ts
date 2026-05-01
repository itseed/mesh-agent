import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import * as schema from '@meshagent/shared';
import { eq } from 'drizzle-orm';

config({ path: resolve(process.cwd(), '../../.env') });

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function seed() {
  console.log('🌱 Seeding mock data...');

  // 1. Projects
  const [projectA] = await db
    .insert(schema.projects)
    .values({
      name: 'MeshAgent Web',
      paths: { web: '/apps/web', api: '/apps/api' },
      githubRepos: ['kriangkrai/mesh-agent'],
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const [projectB] = await db
    .insert(schema.projects)
    .values({
      name: 'Mobile App',
      paths: { mobile: '/apps/mobile' },
      githubRepos: ['kriangkrai/mesh-mobile', 'kriangkrai/mesh-api'],
      isActive: false,
    })
    .onConflictDoNothing()
    .returning();

  const pA =
    projectA ??
    (await db.select().from(schema.projects).where(eq(schema.projects.name, 'MeshAgent Web')))[0];
  const pB =
    projectB ??
    (await db.select().from(schema.projects).where(eq(schema.projects.name, 'Mobile App')))[0];

  // 2. Agent Roles
  const roles = [
    {
      slug: 'frontend',
      name: 'Frontend Engineer',
      description: 'React, Next.js, TypeScript, UI/UX implementation',
      systemPrompt: 'You are a senior frontend engineer...',
      keywords: ['react', 'nextjs', 'typescript', 'tailwind', 'css'],
      isBuiltin: true,
    },
    {
      slug: 'backend',
      name: 'Backend Engineer',
      description: 'REST API, database, business logic',
      systemPrompt: 'You are a senior backend engineer...',
      keywords: ['fastify', 'drizzle', 'postgresql', 'redis', 'api'],
      isBuiltin: true,
    },
    {
      slug: 'mobile',
      name: 'Mobile Engineer',
      description: 'React Native, iOS/Android',
      systemPrompt: 'You are a senior mobile engineer...',
      keywords: ['react-native', 'ios', 'android', 'expo'],
      isBuiltin: true,
    },
    {
      slug: 'devops',
      name: 'DevOps Engineer',
      description: 'CI/CD, Docker, deployment, infrastructure',
      systemPrompt: 'You are a senior devops engineer...',
      keywords: ['docker', 'github-actions', 'nginx', 'linux'],
      isBuiltin: true,
    },
    {
      slug: 'designer',
      name: 'UI Designer',
      description: 'Figma-to-code, design system, accessibility',
      systemPrompt: 'You are a senior UI designer...',
      keywords: ['figma', 'design-system', 'a11y', 'ux'],
      isBuiltin: true,
    },
    {
      slug: 'qa',
      name: 'QA Engineer',
      description: 'Testing — unit, integration, e2e',
      systemPrompt: 'You are a senior QA engineer...',
      keywords: ['vitest', 'playwright', 'testing', 'e2e'],
      isBuiltin: true,
    },
    {
      slug: 'reviewer',
      name: 'Code Reviewer',
      description: 'Code review, security, performance',
      systemPrompt: 'You are a senior code reviewer...',
      keywords: ['code-review', 'security', 'performance'],
      isBuiltin: true,
    },
  ];
  for (const r of roles) {
    await db.insert(schema.agentRoles).values(r).onConflictDoNothing();
  }

  // 3. Tasks — root tasks หลากหลาย stage + priority
  const taskData = [
    {
      title: 'Implement user authentication flow',
      description: 'JWT-based auth with cookie support, refresh tokens, and session management',
      stage: 'done' as const,
      priority: 'high' as const,
      agentRole: 'backend',
      projectId: pA.id,
      status: 'done' as const,
    },
    {
      title: 'Redesign Kanban board with drag-and-drop',
      description:
        'Full visual overhaul using @hello-pangea/dnd, colored stage columns, task cards with priority indicators',
      stage: 'done' as const,
      priority: 'high' as const,
      agentRole: 'frontend',
      projectId: pA.id,
      status: 'done' as const,
    },
    {
      title: 'Set up MinIO for file attachments',
      description:
        'Self-hosted S3-compatible storage, presigned URL upload flow, bucket auto-creation',
      stage: 'done' as const,
      priority: 'medium' as const,
      agentRole: 'devops',
      projectId: pA.id,
      status: 'done' as const,
    },
    {
      title: 'AI task analysis with Claude API',
      description:
        'Auto-analyze task on creation, generate subtask breakdown as lead comment, approval flow',
      stage: 'review' as const,
      priority: 'urgent' as const,
      agentRole: 'backend',
      projectId: pA.id,
      status: 'open' as const,
    },
    {
      title: 'Task Detail Panel — 4 tabs UI',
      description: 'Slide-in drawer with Overview, Comments, Subtasks, Activity tabs',
      stage: 'review' as const,
      priority: 'high' as const,
      agentRole: 'frontend',
      projectId: pA.id,
      status: 'open' as const,
    },
    {
      title: 'Add GitHub PR integration to Projects page',
      description: 'Show open PRs and recent commits per repo in the GitHub tab',
      stage: 'in_progress' as const,
      priority: 'medium' as const,
      agentRole: 'frontend',
      projectId: pA.id,
      status: 'in_progress' as const,
    },
    {
      title: 'Write E2E tests for auth and kanban flows',
      description:
        'Playwright tests covering login, task creation, drag-and-drop, and task detail panel',
      stage: 'in_progress' as const,
      priority: 'medium' as const,
      agentRole: 'qa',
      projectId: pA.id,
      status: 'in_progress' as const,
    },
    {
      title: 'Performance audit — reduce LCP on kanban page',
      description:
        'Current LCP is 3.2s. Target < 1.5s. Investigate heavy components and lazy-load non-critical ones',
      stage: 'backlog' as const,
      priority: 'low' as const,
      agentRole: 'frontend',
      projectId: pA.id,
      status: 'open' as const,
    },
    {
      title: 'Mobile app push notification setup',
      description: 'Firebase FCM integration for task assignment notifications',
      stage: 'backlog' as const,
      priority: 'medium' as const,
      agentRole: 'mobile',
      projectId: pB.id,
      status: 'open' as const,
    },
    {
      title: 'Design onboarding screens',
      description: 'First-run experience: welcome, project setup, GitHub connect',
      stage: 'in_progress' as const,
      priority: 'high' as const,
      agentRole: 'designer',
      projectId: pB.id,
      status: 'in_progress' as const,
    },
    {
      title: 'Security audit — API rate limiting and input validation',
      description:
        'Review all endpoints for injection vulnerabilities, tighten Zod schemas, add missing rate limits',
      stage: 'backlog' as const,
      priority: 'urgent' as const,
      agentRole: 'reviewer',
      projectId: pA.id,
      status: 'open' as const,
    },
    {
      title: 'Docker Compose production config',
      description:
        'Production-ready compose with nginx, SSL termination, health checks, and restart policies',
      stage: 'backlog' as const,
      priority: 'medium' as const,
      agentRole: 'devops',
      projectId: pA.id,
      status: 'open' as const,
    },
  ];

  const insertedTasks: any[] = [];
  for (const t of taskData) {
    const [task] = await db.insert(schema.tasks).values(t).returning();
    insertedTasks.push(task);
  }

  // 4. Subtasks สำหรับ task แรก (auth flow)
  const authTask = insertedTasks[0];
  const subtaskData = [
    {
      title: 'Create JWT sign/verify utility',
      agentRole: 'backend',
      stage: 'done' as const,
      status: 'done' as const,
      priority: 'high' as const,
      parentTaskId: authTask.id,
      projectId: pA.id,
    },
    {
      title: 'Add /auth/login endpoint with rate limiting',
      agentRole: 'backend',
      stage: 'done' as const,
      status: 'done' as const,
      priority: 'high' as const,
      parentTaskId: authTask.id,
      projectId: pA.id,
    },
    {
      title: 'Implement AuthGuard component',
      agentRole: 'frontend',
      stage: 'done' as const,
      status: 'done' as const,
      priority: 'medium' as const,
      parentTaskId: authTask.id,
      projectId: pA.id,
    },
    {
      title: 'Write auth integration tests',
      agentRole: 'qa',
      stage: 'review' as const,
      status: 'open' as const,
      priority: 'medium' as const,
      parentTaskId: authTask.id,
      projectId: pA.id,
    },
  ];
  for (const st of subtaskData) {
    await db.insert(schema.tasks).values(st);
  }

  // 5. Comments สำหรับ AI analysis task (index 3)
  const aiTask = insertedTasks[3];
  await db.insert(schema.taskComments).values({
    taskId: aiTask.id,
    source: 'lead',
    body: JSON.stringify({
      summary:
        'This task requires integrating Claude API into the backend for automatic task analysis. The implementation spans API routes, a new lib module, and frontend approval UI.',
      subtasks: [
        {
          title: 'Install @anthropic-ai/sdk and configure env',
          agentRole: 'backend',
          priority: 'high',
        },
        {
          title: 'Create lib/analyze.ts with Claude API call',
          agentRole: 'backend',
          priority: 'high',
        },
        { title: 'Add POST /tasks/:id/analyze route', agentRole: 'backend', priority: 'high' },
        { title: 'Add POST /tasks/:id/approve route', agentRole: 'backend', priority: 'medium' },
        {
          title: 'Show Analyze button and plan preview in TaskDetailPanel',
          agentRole: 'frontend',
          priority: 'medium',
        },
      ],
    }),
  });
  await db.insert(schema.taskComments).values({
    taskId: aiTask.id,
    source: 'user',
    body: 'ดูดีเลย approve แล้วนะ subtask ครบถ้วนดี',
  });

  // 6. Comments สำหรับ Kanban task (index 1)
  const kanbanTask = insertedTasks[1];
  await db
    .insert(schema.taskComments)
    .values({
      taskId: kanbanTask.id,
      source: 'user',
      body: 'ใช้ @hello-pangea/dnd แทน react-beautiful-dnd เพราะรองรับ React 18 ดีกว่า',
    });
  await db
    .insert(schema.taskComments)
    .values({
      taskId: kanbanTask.id,
      source: 'user',
      body: 'ดีมาก! ขอให้ card มี priority dot ด้วยนะ',
    });

  // 7. Activities
  const activitySeed = [
    { taskId: insertedTasks[0].id, type: 'created', payload: { stage: 'backlog' } },
    {
      taskId: insertedTasks[0].id,
      type: 'stage_changed',
      payload: { from: 'backlog', to: 'in_progress' },
    },
    {
      taskId: insertedTasks[0].id,
      type: 'stage_changed',
      payload: { from: 'in_progress', to: 'done' },
    },
    { taskId: insertedTasks[1].id, type: 'created', payload: { stage: 'backlog' } },
    { taskId: insertedTasks[1].id, type: 'comment_added', payload: { commentCount: 2 } },
    {
      taskId: insertedTasks[1].id,
      type: 'stage_changed',
      payload: { from: 'in_progress', to: 'done' },
    },
    { taskId: insertedTasks[3].id, type: 'created', payload: { stage: 'backlog' } },
    { taskId: insertedTasks[3].id, type: 'analyzed', payload: { subtaskCount: 5 } },
    { taskId: insertedTasks[4].id, type: 'created', payload: { stage: 'in_progress' } },
    { taskId: insertedTasks[6].id, type: 'created', payload: { stage: 'in_progress' } },
  ];
  for (const a of activitySeed) {
    await db.insert(schema.taskActivities).values({ ...a, actorId: null });
  }

  console.log('✅ Seed complete!');
  console.log(
    `   Projects: 2, Tasks: ${insertedTasks.length}, Subtasks: 4, Comments: 4, Activities: ${activitySeed.length}`,
  );
  await client.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});

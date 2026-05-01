import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rmSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import path from 'node:path';
import { projects, tasks, projectContext } from '@meshagent/shared';
import { resolveGitHubClient } from '../lib/github-client.js';
import { env } from '../env.js';

const execFileAsync = promisify(execFile);

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  paths: z.record(z.string()).default({}),
  githubRepos: z.array(z.string()).default([]),
  baseBranch: z.string().min(1).max(255).default('main'),
});

export async function projectRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate];

  fastify.get('/projects', { preHandler }, async () => {
    return fastify.db.select().from(projects).orderBy(projects.createdAt);
  });

  fastify.post('/projects', { preHandler }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const [project] = await fastify.db.insert(projects).values(body).returning();

    let workspacePath: string | null = null;
    if (body.githubRepos.length > 0) {
      const repoUrl = `https://github.com/${body.githubRepos[0]}.git`;
      workspacePath = `${env.WORKSPACES_ROOT}/${project.id}/repo`;
      try {
        execSync(`git clone --depth 1 ${repoUrl} ${workspacePath}`, { stdio: 'inherit' });
        await fastify.db.update(projects).set({ workspacePath }).where(eq(projects.id, project.id));
        project.workspacePath = workspacePath;
      } catch (e: any) {
        fastify.log.warn(
          { err: e?.message, repoUrl },
          'Failed to clone repo — project created without workspace',
        );
        workspacePath = null;
      }
    }

    reply.status(201);
    return project;
  });

  fastify.patch('/projects/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createProjectSchema.partial().parse(request.body);
    const [updated] = await fastify.db
      .update(projects)
      .set(body)
      .where(eq(projects.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Not found' });
    return updated;
  });

  fastify.patch('/projects/:id/activate', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    let project: typeof projects.$inferSelect | undefined;
    await fastify.db.transaction(async (tx) => {
      await tx.update(projects).set({ isActive: false }).where(eq(projects.isActive, true));
      const [updated] = await tx
        .update(projects)
        .set({ isActive: true })
        .where(eq(projects.id, id))
        .returning();
      project = updated;
    });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return project;
  });

  // GET /projects/:id/github — fetch PRs + commits for all repos linked to this project
  fastify.get('/projects/:id/github', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [project] = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const repos: string[] = project.githubRepos ?? [];
    if (!repos.length) return reply.send({ prs: [], commits: [] });

    let gh;
    try {
      gh = await resolveGitHubClient(fastify.redis);
    } catch {
      return reply.status(503).send({ error: 'GITHUB_TOKEN not configured' });
    }

    const results = await Promise.allSettled(
      repos.map(async (repo) => {
        const [owner, repoName] = repo.split('/');
        const [prsRes, commitsRes] = await Promise.all([
          gh.pulls.list({ owner, repo: repoName, state: 'open', per_page: 10 }),
          gh.repos.listCommits({ owner, repo: repoName, per_page: 10 }),
        ]);
        return {
          repo,
          prs: prsRes.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            url: pr.html_url,
            author: pr.user?.login ?? null,
          })),
          commits: commitsRes.data.map((c) => ({
            sha: c.sha.slice(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author?.name ?? null,
            date: c.commit.author?.date ?? null,
          })),
        };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value);
  });

  fastify.get('/projects/:id/disk-usage', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [project] = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return reply.status(404).send({ error: 'Not found' });
    const projectDir = path.join(env.REPOS_BASE_DIR, id);
    if (!existsSync(projectDir)) return { bytes: 0, human: '0 B' };
    try {
      const { stdout } = await execFileAsync('du', ['-sk', projectDir], { encoding: 'utf8' });
      const kb = parseInt(String(stdout).trim().split('\t')[0], 10);
      const bytes = isNaN(kb) ? 0 : kb * 1024;
      return { bytes, human: formatBytes(bytes) };
    } catch {
      return { bytes: 0, human: '0 B' };
    }
  });

  fastify.delete('/projects/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!existing.length) return reply.status(404).send({ error: 'Not found' });
    if (existing[0].workspacePath) {
      rmSync(`${env.WORKSPACES_ROOT}/${id}`, { recursive: true, force: true });
    }
    // Also remove repo clone dir from REPOS_BASE_DIR
    rmSync(path.join(env.REPOS_BASE_DIR, id), { recursive: true, force: true });
    await fastify.db.delete(tasks).where(eq(tasks.projectId, id));
    await fastify.db.delete(projects).where(eq(projects.id, id));
    return reply.status(204).send();
  });

  fastify.get('/projects/:id/context', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [ctx] = await fastify.db
      .select()
      .from(projectContext)
      .where(eq(projectContext.projectId, id))
      .limit(1);
    return ctx ?? { projectId: id, brief: '', autoContext: '', updatedAt: null };
  });

  fastify.post('/projects/:id/context', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { brief = '' } = (request.body ?? {}) as { brief?: string };

    // Load project to find read directory
    const [project] = await fastify.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const readDir =
      project.workspacePath ??
      Object.values((project.paths as Record<string, string>) ?? {})[0] ??
      null;

    // Auto-read CLAUDE.md + README.md (best-effort)
    let autoContext = '';
    if (readDir) {
      const candidates = ['CLAUDE.md', 'README.md'];
      const chunks: string[] = [];
      for (const filename of candidates) {
        try {
          const content = await readFile(join(readDir, filename), 'utf-8');
          if (content.trim()) chunks.push(content.trim());
          if (chunks.join('\n\n').length >= 4000) break;
        } catch {
          // file not found or unreadable — skip
        }
      }
      autoContext = chunks.join('\n\n---\n\n').slice(0, 4000);
    }

    // Upsert projectContext row
    await fastify.db
      .insert(projectContext)
      .values({ projectId: id, brief: brief.trim(), autoContext, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: projectContext.projectId,
        set: { brief: brief.trim(), autoContext, updatedAt: new Date() },
      });

    return { ok: true, autoContext };
  });
}

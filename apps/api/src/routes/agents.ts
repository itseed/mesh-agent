import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { agentSessions, agentRoles, agentMetrics } from '@meshagent/shared';
import { env } from '../env.js';
import { logAudit } from '../lib/audit.js';
import { companionManager } from '../lib/companionManager.js';

const dispatchSchema = z.object({
  role: z.string().min(1).max(64),
  workingDir: z.string().min(1).max(1024),
  prompt: z
    .string()
    .min(1)
    .max(64 * 1024),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  cli: z.enum(['claude', 'gemini', 'cursor']).optional(),
});

async function proxyFetch(url: string, init?: RequestInit, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function agentRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate];

  fastify.get('/agents', { preHandler }, async () => {
    // Query DB directly — covers both cloud (orchestrator) and local (companion) sessions
    const running = await fastify.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.status, 'running'))
      .orderBy(desc(agentSessions.createdAt))
      .limit(50);
    return running.map((r) => ({
      id: r.id,
      role: r.role,
      status: r.status,
      executionMode: r.executionMode,
      projectId: r.projectId,
      taskId: r.taskId,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    }));
  });

  fastify.get('/agents/history', { preHandler }, async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    const rows = await fastify.db
      .select()
      .from(agentSessions)
      .orderBy(desc(agentSessions.createdAt))
      .limit(limit);
    return rows;
  });

  fastify.post('/agents', { preHandler }, async (request, reply) => {
    const parsed = dispatchSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    const body = parsed.data;

    const [role] = await fastify.db.select().from(agentRoles).where(eq(agentRoles.slug, body.role));
    if (!role) {
      return reply.status(400).send({ error: `Unknown agent role: ${body.role}` });
    }

    const userId = (request.user as { id: string }).id;
    const res = await proxyFetch(`${env.ORCHESTRATOR_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: body.role,
        workingDir: body.workingDir,
        prompt: body.prompt,
        projectId: body.projectId ?? null,
        taskId: body.taskId ?? null,
        createdBy: userId,
        ...(body.cli ? { cliProvider: body.cli } : {}),
      }),
    });
    if (!res) return reply.status(502).send({ error: 'Orchestrator unavailable' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      return reply.status(res.status).send(err);
    }

    const json = await res.json();
    const sessionId = (json as any).id as string | undefined;
    if (sessionId && body.cli) {
      fastify.db
        .update(agentSessions)
        .set({ cliProvider: body.cli })
        .where(eq(agentSessions.id, sessionId))
        .catch((err: unknown) =>
          fastify.log.warn({ err, sessionId }, 'Failed to save cliProvider'),
        );
    }
    await logAudit(fastify, request, {
      action: 'agent.dispatch',
      target: (json as any).id,
      metadata: { role: body.role, workingDir: body.workingDir },
    });
    reply.status(201);
    return json;
  });

  fastify.delete('/agents/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await proxyFetch(`${env.ORCHESTRATOR_URL}/sessions/${id}`, { method: 'DELETE' });
    await logAudit(fastify, request, { action: 'agent.stopped', target: id });
    reply.status(204).send();
  });

  // ----- Roles registry -----

  fastify.get('/agents/roles', { preHandler }, async () => {
    return fastify.db.select().from(agentRoles).orderBy(agentRoles.name);
  });

  const roleSchema = z.object({
    slug: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9_-]+$/),
    name: z.string().min(1).max(128),
    description: z.string().max(2048).optional(),
    systemPrompt: z
      .string()
      .max(32 * 1024)
      .optional(),
    keywords: z.array(z.string().max(64)).max(50).default([]),
  });

  const requireAdmin = async (request: any, reply: any) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    if ((request.user as { role: string }).role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden — admin only' });
    }
  };

  fastify.post('/agents/roles', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = roleSchema.parse(request.body);
    const [created] = await fastify.db
      .insert(agentRoles)
      .values({ ...body, isBuiltin: false })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      return reply.status(409).send({ error: `Role slug "${body.slug}" already exists` });
    }
    await logAudit(fastify, request, { action: 'agent.role.created', target: created.slug });
    return created;
  });

  fastify.patch('/agents/roles/:slug', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = roleSchema.partial({ slug: true }).parse(request.body);
    const [updated] = await fastify.db
      .update(agentRoles)
      .set(body)
      .where(eq(agentRoles.slug, slug))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Role not found' });
    await logAudit(fastify, request, { action: 'agent.role.updated', target: slug });
    return updated;
  });

  fastify.delete('/agents/roles/:slug', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const [existing] = await fastify.db.select().from(agentRoles).where(eq(agentRoles.slug, slug));
    if (!existing) return reply.status(404).send({ error: 'Role not found' });
    if (existing.isBuiltin) {
      return reply.status(400).send({ error: 'Cannot delete a builtin role' });
    }
    await fastify.db.delete(agentRoles).where(eq(agentRoles.slug, slug));
    await logAudit(fastify, request, { action: 'agent.role.deleted', target: slug });
    reply.status(204).send();
  });

  // ----- Metrics -----

  fastify.get('/agents/metrics', { preHandler }, async (request) => {
    const { sinceHours } = z
      .object({
        sinceHours: z.coerce
          .number()
          .int()
          .min(1)
          .max(24 * 30)
          .default(24),
      })
      .parse(request.query);

    const since = new Date(Date.now() - sinceHours * 3600 * 1000);
    const rows = await fastify.db
      .select({
        role: agentMetrics.role,
        count: sql<number>`count(*)::int`,
        successCount: sql<number>`sum(case when ${agentMetrics.success} then 1 else 0 end)::int`,
        avgDurationMs: sql<number>`coalesce(avg(${agentMetrics.durationMs}), 0)::int`,
        totalOutputBytes: sql<number>`coalesce(sum(${agentMetrics.outputBytes}), 0)::bigint`,
      })
      .from(agentMetrics)
      .where(gte(agentMetrics.createdAt, since))
      .groupBy(agentMetrics.role);

    return {
      sinceHours,
      perRole: rows,
      totals: rows.reduce(
        (acc, r) => ({
          count: acc.count + r.count,
          successCount: acc.successCount + r.successCount,
        }),
        { count: 0, successCount: 0 },
      ),
    };
  });

  fastify.get('/agents/metrics/by-provider', { preHandler }, async (request, reply) => {
    const qParsed = z
      .object({ sinceHours: z.coerce.number().int().min(1).max(720).default(24) })
      .safeParse(request.query);
    if (!qParsed.success)
      return reply
        .status(400)
        .send({ error: qParsed.error.issues[0]?.message ?? 'Invalid request' });
    const { sinceHours } = qParsed.data;

    const since = new Date(Date.now() - sinceHours * 3600 * 1000);

    const rows = await fastify.db
      .select({
        provider: sql<string>`COALESCE(${agentSessions.cliProvider}, 'claude')`,
        count: sql<number>`count(*)::int`,
        successCount: sql<number>`sum(CASE WHEN ${agentSessions.status} = 'completed' THEN 1 ELSE 0 END)::int`,
        avgDurationMs: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${agentSessions.endedAt} - ${agentSessions.startedAt})) * 1000), 0)::int`,
      })
      .from(agentSessions)
      .where(gte(agentSessions.createdAt, since))
      .groupBy(sql`COALESCE(${agentSessions.cliProvider}, 'claude')`);

    return { sinceHours, perProvider: rows };
  });

  fastify.get('/agents/sessions/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [session] = await fastify.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .limit(1);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return session;
  });

  fastify.get('/agents/sessions/:id/output', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { from } = request.query as { from?: string };

    if (id.startsWith('local-')) {
      const userId = (request.user as { id: string }).id;
      try {
        const result = (await companionManager.call(userId, 'agent.stdout', { sessionId: id })) as {
          output: string;
          running: boolean;
        };
        return { output: result.output ?? '', running: result.running ?? false };
      } catch {
        return { output: '', running: false };
      }
    }

    const fromParam = from ? `?from=${encodeURIComponent(from)}` : '';
    const res = await proxyFetch(`${env.ORCHESTRATOR_URL}/sessions/${id}/output${fromParam}`);
    if (!res || !res.ok)
      return reply.status(res?.status ?? 502).send({ error: 'Failed to get output' });
    return res.json();
  });

  fastify.get('/agents/sessions/by-task/:taskId', { preHandler }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const [session] = await fastify.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.taskId, taskId))
      .orderBy(desc(agentSessions.createdAt))
      .limit(1);
    if (!session) return reply.status(404).send({ error: 'No session found' });
    return session;
  });
}

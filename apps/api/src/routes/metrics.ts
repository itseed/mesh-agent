import { FastifyInstance } from 'fastify';
import { sql, gte } from 'drizzle-orm';
import { agentMetrics, agentSessions, tasks } from '@meshagent/shared';
import { env } from '../env.js';

export async function metricsRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate];

  fastify.get('/metrics/tokens', { preHandler }, async () => {
    const [inputStr, outputStr, costStr] = await Promise.all([
      fastify.redis.get('lead:tokens:input'),
      fastify.redis.get('lead:tokens:output'),
      fastify.redis.get('lead:tokens:cost_usd'),
    ]);
    const inputTokens = Number(inputStr ?? 0);
    const outputTokens = Number(outputStr ?? 0);
    const costUsd = parseFloat(costStr ?? '0');
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: Math.round(costUsd * 100000) / 100000,
    };
  });

  fastify.get('/metrics/health', { preHandler }, async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [taskCount] = await fastify.db.select({ count: sql<number>`count(*)::int` }).from(tasks);
    const [sessionCount] = await fastify.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentSessions);
    const [recentMetrics] = await fastify.db
      .select({
        count: sql<number>`count(*)::int`,
        avgDurationMs: sql<number>`coalesce(avg(${agentMetrics.durationMs}), 0)::int`,
        successRate: sql<number>`coalesce(avg(case when ${agentMetrics.success} then 1.0 else 0.0 end), 0)::float`,
      })
      .from(agentMetrics)
      .where(gte(agentMetrics.createdAt, since));

    let orchestratorOk = false;
    let orchestratorActive = 0;
    try {
      const res = await fetch(`${env.ORCHESTRATOR_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = (await res.json()) as { activeSessions?: number };
        orchestratorOk = true;
        orchestratorActive = body.activeSessions ?? 0;
      }
    } catch {
      orchestratorOk = false;
    }

    return {
      tasks: taskCount.count,
      totalSessions: sessionCount.count,
      last24h: recentMetrics,
      orchestrator: { ok: orchestratorOk, activeSessions: orchestratorActive },
    };
  });
}

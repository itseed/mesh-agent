import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { agentRoutes } from '../routes/agents.js';

async function buildApp(dbRows: any[] = []): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (_req: any, _reply: any) => {
    _req.user = { id: 'user-1', role: 'admin' };
  });

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue(dbRows),
    // For other routes in agentRoutes that need these methods
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  app.decorate('db', mockDb as any);
  app.decorate('redis', { publish: vi.fn() } as any);

  await app.register(agentRoutes);
  return app;
}

describe('GET /agents/metrics/by-provider', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('returns perProvider array with session stats', async () => {
    app = await buildApp([
      { provider: 'claude', count: 12, successCount: 10, avgDurationMs: 270000 },
      { provider: 'gemini', count: 3, successCount: 3, avgDurationMs: 180000 },
    ]);

    const res = await app.inject({ method: 'GET', url: '/agents/metrics/by-provider' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sinceHours).toBe(24);
    expect(body.perProvider).toHaveLength(2);
    expect(body.perProvider[0]).toMatchObject({
      provider: 'claude',
      count: 12,
      successCount: 10,
      avgDurationMs: 270000,
    });
  });

  it('returns empty perProvider when no sessions', async () => {
    app = await buildApp([]);
    const res = await app.inject({ method: 'GET', url: '/agents/metrics/by-provider' });
    expect(res.statusCode).toBe(200);
    expect(res.json().perProvider).toEqual([]);
  });

  it('respects sinceHours query param', async () => {
    app = await buildApp([]);
    const res = await app.inject({
      method: 'GET',
      url: '/agents/metrics/by-provider?sinceHours=168',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sinceHours).toBe(168);
  });

  it('rejects sinceHours > 720 with 400', async () => {
    app = await buildApp([]);
    const res = await app.inject({
      method: 'GET',
      url: '/agents/metrics/by-provider?sinceHours=999',
    });
    expect(res.statusCode).toBe(400);
  });
});

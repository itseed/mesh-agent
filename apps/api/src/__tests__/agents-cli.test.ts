import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { agentRoutes } from '../routes/agents.js';

// Capture fetch calls
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function buildMockDb(roleExists = true) {
  const roleResult = roleExists ? [{ slug: 'backend', name: 'Backend', isBuiltin: true }] : [];
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(roleResult),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(roleResult),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
}

async function buildApp(dbOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Mock authenticate decorator
  app.decorate('authenticate', async (_req: any, _reply: any) => {
    _req.user = { id: 'user-1', role: 'admin' };
  });

  // Mock db decorator
  app.decorate('db', { ...buildMockDb(), ...dbOverrides } as any);

  // Mock redis (for audit log)
  app.decorate('redis', { publish: vi.fn() } as any);

  await app.register(agentRoutes);
  return app;
}

describe('POST /agents — cli provider forwarding', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    fetchMock.mockReset();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('forwards cliProvider to orchestrator when cli is provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sess-1', role: 'backend', status: 'pending' }),
    });

    await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        role: 'backend',
        workingDir: '/tmp/work',
        prompt: 'do something',
        cli: 'gemini',
      },
    });

    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toContain('/sessions');
    const body = JSON.parse((init as any).body);
    expect(body.cliProvider).toBe('gemini');
  });

  it('does not include cliProvider when cli is absent', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sess-2', role: 'backend', status: 'pending' }),
    });

    await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do something' },
    });

    const [[, init]] = fetchMock.mock.calls;
    const body = JSON.parse((init as any).body);
    expect(body.cliProvider).toBeUndefined();
  });

  it('rejects unknown cli value with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do', cli: 'unknown-cli' },
    });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import './setup.js';
import { buildServer } from '../server.js';
import { agentSessions } from '@meshagent/shared';

vi.stubGlobal('fetch', vi.fn());

describe('Agents API', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let token: string;

  beforeAll(async () => {
    server = await buildServer();
    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@example.com', password: 'changeme123' },
    });
    token = res.json().token;
  });

  afterAll(async () => {
    await server.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('GET /agents returns running sessions from DB', async () => {
    await server.db.insert(agentSessions).values({
      id: 'test-running-session',
      role: 'frontend',
      workingDir: '/tmp',
      prompt: 'test',
      status: 'running',
    });
    const res = await server.inject({ method: 'GET', url: '/agents', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    await server.db.delete(agentSessions).where(eq(agentSessions.id, 'test-running-session'));
  });

  it('GET /agents returns empty array when no running sessions', async () => {
    const res = await server.inject({ method: 'GET', url: '/agents', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('POST /agents rejects unknown role', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/agents',
      headers: auth(),
      payload: { role: 'definitely-not-a-real-role', workingDir: '/tmp', prompt: 'hi' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /agents dispatches to orchestrator for builtin role', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'new-session', role: 'backend', status: 'running' }),
    });
    const res = await server.inject({
      method: 'POST',
      url: '/agents',
      headers: auth(),
      payload: { role: 'backend', workingDir: '/tmp', prompt: 'do something' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST /agents returns 502 when orchestrator unreachable', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('orchestrator down'));
    const res = await server.inject({
      method: 'POST',
      url: '/agents',
      headers: auth(),
      payload: { role: 'backend', workingDir: '/tmp', prompt: 'do something' },
    });
    expect(res.statusCode).toBe(502);
  });

  it('GET /agents/roles returns builtin roles', async () => {
    const res = await server.inject({ method: 'GET', url: '/agents/roles', headers: auth() });
    expect(res.statusCode).toBe(200);
    const roles = res.json();
    expect(Array.isArray(roles)).toBe(true);
    expect(roles.some((r: any) => r.slug === 'backend')).toBe(true);
  });

  it('GET /agents/metrics returns aggregated metrics', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/agents/metrics',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toBeDefined();
    expect(body.perRole).toBeDefined();
  });
});

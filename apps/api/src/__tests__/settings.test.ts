import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import './setup.js';
import { buildServer } from '../server.js';

vi.stubGlobal('fetch', vi.fn());

describe('Settings routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let token: string;

  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe('GET /settings/claude/test', () => {
    it('proxies to orchestrator /health/claude and returns response', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, version: 'claude/1.2.3', cmd: '/usr/local/bin/claude' }),
      });
      const res = await server.inject({
        method: 'GET',
        url: '/settings/claude/test',
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        version: 'claude/1.2.3',
        cmd: '/usr/local/bin/claude',
      });
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toContain('/health/claude');
    });

    it('returns ok=false when orchestrator is unreachable', async () => {
      (fetch as any).mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const res = await server.inject({
        method: 'GET',
        url: '/settings/claude/test',
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(false);
    });
  });

  describe('POST /settings/cli/claude/token', () => {
    it('proxies token to orchestrator /health/claude/token', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, path: '/root/.claude/token' }),
      });
      const res = await server.inject({
        method: 'POST',
        url: '/settings/cli/claude/token',
        headers: auth(),
        payload: { token: 'mytoken123' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, path: '/root/.claude/token' });
      const [url, opts] = (fetch as any).mock.calls[0];
      expect(url).toContain('/health/claude/token');
      expect(JSON.parse(opts.body).token).toBe('mytoken123');
    });
  });

  describe('Removed routes', () => {
    it('POST /settings/claude/cmd returns 404', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/settings/claude/cmd',
        headers: auth(),
        payload: { cmd: 'claude' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DELETE /settings/claude/cmd returns 404', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/settings/claude/cmd',
        headers: auth(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /settings', () => {
    it('no longer returns cli.cmd or cli.source', async () => {
      const res = await server.inject({ method: 'GET', url: '/settings', headers: auth() });
      expect(res.statusCode).toBe(200);
      expect(res.json().cli?.cmd).toBeUndefined();
      expect(res.json().cli?.source).toBeUndefined();
    });

    it('returns cli.orchestratorUrl', async () => {
      const res = await server.inject({ method: 'GET', url: '/settings', headers: auth() });
      expect(res.json().cli?.orchestratorUrl).toBeTruthy();
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { api } from '@/lib/api';

const fetchMock = vi.fn();

describe('api client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  it('uses credentials: include for cookie auth', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', email: 'admin@example.com', role: 'admin' }),
    });
    await api.auth.me();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/me$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('serializes login body and posts JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 'u1', email: 'a@b.c', role: 'admin' } }),
    });
    await api.auth.login('a@b.c', 'pw123456');
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].body).toBe(
      JSON.stringify({ email: 'a@b.c', password: 'pw123456', remember: false }),
    );
    expect(call[1].headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('extracts error message from non-OK response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'Invalid credentials' }),
    });
    await expect(api.auth.login('x@y.z', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('returns undefined on 204', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    const res = await api.tasks.delete('abc');
    expect(res).toBeUndefined();
  });

  it('encodes repo query parameter', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    await api.github.prs('owner/repo with spaces');
    expect(fetchMock.mock.calls[0][0]).toMatch(/repo=owner%2Frepo%20with%20spaces/);
  });
});

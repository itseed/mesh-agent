import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

vi.mock('../git.js', () => ({
  ensureRepo: vi.fn().mockResolvedValue(undefined),
  createWorktree: vi.fn().mockResolvedValue('/repos/proj/my-repo/worktrees/task-abc'),
}));

import { ensureRepo, createWorktree } from '../git.js';
import { sessionRoutes } from '../routes/sessions.js';

function buildMockManager(overrides = {}) {
  return {
    activeCount: 0,
    createSession: vi.fn().mockResolvedValue({
      id: 'sess-1',
      role: 'backend',
      status: 'pending',
      start: vi.fn().mockResolvedValue({}),
    }),
    listSessions: vi.fn().mockReturnValue([]),
    getSession: vi.fn().mockReturnValue(undefined),
    removeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildMockStore() {
  return {
    findById: vi.fn().mockResolvedValue(null),
  };
}

async function buildApp(managerOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sessionRoutes, {
    manager: buildMockManager(managerOverrides) as any,
    store: buildMockStore() as any,
  });
  return app;
}

describe('POST /sessions with cliProvider', () => {
  let app: FastifyInstance;
  let createSessionMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createSessionMock = vi.fn().mockResolvedValue({
      id: 'sess-p',
      role: 'backend',
      status: 'pending',
      start: vi.fn().mockResolvedValue({}),
    });
    app = await buildApp({ createSession: createSessionMock });
  });
  afterEach(async () => {
    await app.close();
  });

  it('passes cliProvider to manager.createSession when provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        role: 'backend',
        workingDir: '/tmp/work',
        prompt: 'do something',
        cliProvider: 'gemini',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ cliProvider: 'gemini' }),
    );
  });

  it('does not include cliProvider when absent', async () => {
    await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do something' },
    });
    const call = createSessionMock.mock.calls[0][0];
    expect(call.cliProvider).toBeUndefined();
  });

  it('rejects invalid cliProvider value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do', cliProvider: 'bad-cli' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /sessions with repoUrl', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.mocked(ensureRepo).mockReset().mockResolvedValue(undefined);
    vi.mocked(createWorktree)
      .mockReset()
      .mockResolvedValue('/repos/proj/my-repo/worktrees/task-abc');
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('calls ensureRepo and createWorktree when repoUrl provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        role: 'backend',
        workingDir: '/repos/proj/my-repo',
        prompt: 'do work',
        taskId: 'task-abc',
        repoUrl: 'https://github.com/owner/repo.git',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(ensureRepo).toHaveBeenCalledWith(
      '/repos/proj/my-repo',
      'https://github.com/owner/repo.git',
    );
    expect(createWorktree).toHaveBeenCalledWith('/repos/proj/my-repo', 'task-abc');
  });

  it('skips git ops when repoUrl is absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'backend', workingDir: '/some/path', prompt: 'do work' },
    });
    expect(res.statusCode).toBe(201);
    expect(ensureRepo).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('returns 500 when ensureRepo throws (clone fail)', async () => {
    vi.mocked(ensureRepo).mockRejectedValue(new Error('Authentication failed'));
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        role: 'backend',
        workingDir: '/repos/proj/my-repo',
        prompt: 'do work',
        taskId: 'task-abc',
        repoUrl: 'https://github.com/owner/repo.git',
      },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('Authentication failed');
  });
});

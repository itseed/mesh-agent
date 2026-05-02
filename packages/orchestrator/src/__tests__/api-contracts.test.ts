/**
 * API response-format and data-consistency tests.
 *
 * Verifies that every endpoint returns the exact shape, status code, and field
 * types that clients (mobile app, web app, orchestrator CLI) depend on.  These
 * tests are intentionally format-focused rather than behaviour-focused — they
 * complement the existing prompt/sessions-git tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { sessionRoutes } from '../routes/sessions.js';
import { promptRoutes } from '../routes/prompt.js';

// ─── execFile mock (shared with prompt routes) ─────────────────────────────
const { execFileMock } = vi.hoisted(() => {
  const { promisify } = require('node:util');
  const m = vi.fn();
  (m as any)[promisify.custom] = (...args: any[]) =>
    new Promise((resolve, reject) => {
      m(...args, (err: any, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { execFileMock: m };
});
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('../git.js', () => ({
  ensureRepo: vi.fn().mockResolvedValue(undefined),
  createWorktree: vi.fn().mockResolvedValue('/repos/proj/repo/worktrees/task-1'),
}));

// ─── mock builder helpers ───────────────────────────────────────────────────
function mockManager(overrides: Record<string, unknown> = {}) {
  return {
    activeCount: 0,
    createSession: vi.fn().mockResolvedValue({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      role: 'backend',
      status: 'pending',
      start: vi.fn().mockResolvedValue({}),
    }),
    listSessions: vi.fn().mockReturnValue([]),
    getSession: vi.fn().mockReturnValue(undefined),
    getSessionOutput: vi.fn().mockReturnValue({ output: '', running: false }),
    removeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockStore(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

async function buildSessionApp(
  mgr: ReturnType<typeof mockManager>,
  store: ReturnType<typeof mockStore>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sessionRoutes, { manager: mgr as any, store: store as any });
  return app;
}

async function buildPromptApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(promptRoutes);
  return app;
}

/** Minimal server that exposes /health and /metrics/concurrency with a mock manager */
function buildMetaApp(mgr: ReturnType<typeof mockManager>): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
    activeSessions: mgr.activeCount,
    maxConcurrent: 4,
  }));
  app.get('/metrics/concurrency', async () => ({
    active: mgr.activeCount,
    max: 4,
    sessions: (mgr.listSessions() as any[]).map((s) => ({
      id: s.id,
      role: s.role,
      status: s.status,
    })),
  }));
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /health
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /health', () => {
  it('returns status ok with timestamp and numeric counters', async () => {
    const app = buildMetaApp(mockManager({ activeCount: 2 }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', activeSessions: 2, maxConcurrent: 4 });
    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(typeof body.activeSessions).toBe('number');
    expect(typeof body.maxConcurrent).toBe('number');
    await app.close();
  });

  it('timestamp is an ISO 8601 string', async () => {
    const app = buildMetaApp(mockManager());
    const before = Date.now();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const after = Date.now();
    const body = res.json();
    const ts = new Date(body.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    await app.close();
  });

  it('activeSessions reflects the manager activeCount', async () => {
    const app = buildMetaApp(mockManager({ activeCount: 0 }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().activeSessions).toBe(0);
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /metrics/concurrency
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /metrics/concurrency', () => {
  it('returns numeric active/max and an empty sessions array when idle', async () => {
    const app = buildMetaApp(mockManager());
    const res = await app.inject({ method: 'GET', url: '/metrics/concurrency' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ active: 0, max: 4, sessions: [] });
    expect(Array.isArray(body.sessions)).toBe(true);
    await app.close();
  });

  it('sessions array contains id, role, status fields', async () => {
    const liveSessions = [
      { id: 'sess-1', role: 'backend', status: 'running' },
      { id: 'sess-2', role: 'frontend', status: 'pending' },
    ];
    const mgr = mockManager({
      activeCount: 2,
      listSessions: vi.fn().mockReturnValue(liveSessions),
    });
    const app = buildMetaApp(mgr);
    const res = await app.inject({ method: 'GET', url: '/metrics/concurrency' });
    expect(res.statusCode).toBe(200);
    const { sessions } = res.json();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({ id: 'sess-1', role: 'backend', status: 'running' });
    expect(sessions[1]).toEqual({ id: 'sess-2', role: 'frontend', status: 'pending' });
    await app.close();
  });

  it('sessions items do NOT expose workingDir or prompt (security)', async () => {
    const liveSessions = [
      { id: 'x', role: 'qa', status: 'running', workingDir: '/secret', prompt: 'secret' },
    ];
    const mgr = mockManager({ listSessions: vi.fn().mockReturnValue(liveSessions) });
    const app = buildMetaApp(mgr);
    const res = await app.inject({ method: 'GET', url: '/metrics/concurrency' });
    const { sessions } = res.json();
    expect(sessions[0]).not.toHaveProperty('workingDir');
    expect(sessions[0]).not.toHaveProperty('prompt');
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /sessions
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /sessions – response format', () => {
  let app: FastifyInstance;
  let mgr: ReturnType<typeof mockManager>;

  beforeEach(async () => {
    mgr = mockManager();
    app = await buildSessionApp(mgr, mockStore());
  });
  afterEach(() => app.close());

  it('201 body has exactly id, role, status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'backend', workingDir: '/tmp/work', prompt: 'do something' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('role', 'backend');
    expect(body).toHaveProperty('status', 'pending');
    // Must NOT leak workingDir or prompt back to caller
    expect(body).not.toHaveProperty('workingDir');
    expect(body).not.toHaveProperty('prompt');
  });

  it('201 id is a non-empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'frontend', workingDir: '/tmp', prompt: 'hi' },
    });
    expect(typeof res.json().id).toBe('string');
    expect(res.json().id.length).toBeGreaterThan(0);
  });

  it('status in 201 response is pending', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'qa', workingDir: '/tmp', prompt: 'run tests' },
    });
    expect(res.json().status).toBe('pending');
  });

  it('400 body has error string on missing required field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'backend' }, // missing workingDir and prompt
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('400 on role exceeding 64 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'x'.repeat(65), workingDir: '/tmp', prompt: 'hi' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('400 on prompt exceeding 64 KB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'qa', workingDir: '/tmp', prompt: 'x'.repeat(65 * 1024) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('429 body has error string when concurrency limit hit', async () => {
    mgr.createSession = vi
      .fn()
      .mockRejectedValue(new Error('Concurrency limit reached (4). Stop a session and retry.'));
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { role: 'devops', workingDir: '/tmp', prompt: 'deploy' },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Concurrency limit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /sessions
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /sessions – response format', () => {
  let app: FastifyInstance;

  afterEach(() => app.close());

  it('returns an empty array when no sessions exist', async () => {
    app = await buildSessionApp(mockManager(), mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('session items contain id, role, status, legacyStatus, pid, projectId, taskId', async () => {
    const sessions = [
      {
        id: 'sess-abc',
        role: 'mobile',
        status: 'running',
        legacyStatus: 'running',
        pid: 1234,
        projectId: 'proj-1',
        taskId: 'task-1',
      },
    ];
    const mgr = mockManager({ listSessions: vi.fn().mockReturnValue(sessions) });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(200);
    const items = res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: 'sess-abc',
      role: 'mobile',
      status: 'running',
      legacyStatus: 'running',
      pid: 1234,
      projectId: 'proj-1',
      taskId: 'task-1',
    });
  });

  it('session items do NOT expose workingDir, prompt, or error', async () => {
    const sessions = [
      {
        id: 'sess-xyz',
        role: 'backend',
        status: 'completed',
        legacyStatus: 'idle',
        pid: null,
        projectId: null,
        taskId: null,
        workingDir: '/secret',
        prompt: 'secret prompt',
        error: 'some error',
      },
    ];
    const mgr = mockManager({ listSessions: vi.fn().mockReturnValue(sessions) });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    const item = res.json()[0];
    expect(item).not.toHaveProperty('workingDir');
    expect(item).not.toHaveProperty('prompt');
    // error field is intentionally excluded from the list endpoint
    expect(item).not.toHaveProperty('error');
  });

  it('pid is null (not undefined) when process has not started', async () => {
    const sessions = [
      {
        id: 's1',
        role: 'qa',
        status: 'pending',
        legacyStatus: 'running',
        pid: null,
        projectId: null,
        taskId: null,
      },
    ];
    const mgr = mockManager({ listSessions: vi.fn().mockReturnValue(sessions) });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    const item = res.json()[0];
    expect(item.pid).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /sessions/:id
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /sessions/:id – response format', () => {
  let app: FastifyInstance;

  afterEach(() => app.close());

  it('returns live session with id, role, status, legacyStatus, pid, projectId, taskId, error fields', async () => {
    const liveSession = {
      id: 'live-1',
      role: 'designer',
      status: 'running',
      legacyStatus: 'running',
      pid: 5555,
      projectId: 'proj-a',
      taskId: 'task-b',
      error: null,
    };
    const mgr = mockManager({ getSession: vi.fn().mockReturnValue(liveSession) });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/live-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'live-1',
      role: 'designer',
      status: 'running',
      legacyStatus: 'running',
      pid: 5555,
      projectId: 'proj-a',
      taskId: 'task-b',
      error: null,
    });
  });

  it('error field is null (not undefined) when no error has occurred', async () => {
    const liveSession = {
      id: 's1',
      role: 'qa',
      status: 'running',
      legacyStatus: 'running',
      pid: 1,
      projectId: null,
      taskId: null,
      error: null,
    };
    const mgr = mockManager({ getSession: vi.fn().mockReturnValue(liveSession) });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/s1' });
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBeNull();
  });

  it('live session detail includes legacyStatus consistent with list endpoint', async () => {
    const liveSession = {
      id: 's2',
      role: 'frontend',
      status: 'completed',
      legacyStatus: 'idle',
      pid: null,
      projectId: null,
      taskId: null,
      error: null,
    };
    const mgr = mockManager({ getSession: vi.fn().mockReturnValue(liveSession) });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/s2' });
    const body = res.json();
    expect(body).toHaveProperty('legacyStatus');
    expect(body.legacyStatus).toBe('idle');
  });

  it('falls back to persisted session when not in memory', async () => {
    const persisted = {
      id: 'old-1',
      role: 'backend',
      status: 'completed',
      pid: null,
      projectId: null,
      taskId: null,
      error: null,
      workingDir: '/tmp',
      prompt: 'x',
      cliProvider: null,
      executionMode: 'cloud',
      exitCode: 0,
      outputLog: 'done',
      createdBy: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date('2024-01-01'),
    };
    const store = mockStore({ findById: vi.fn().mockResolvedValue(persisted) });
    app = await buildSessionApp(mockManager(), store);
    const res = await app.inject({ method: 'GET', url: '/sessions/old-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('old-1');
    expect(body.status).toBe('completed');
    // Persisted sessions DO include workingDir (full DB record)
    expect(body).toHaveProperty('workingDir');
  });

  it('404 body has error string when session not found', async () => {
    app = await buildSessionApp(mockManager(), mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/nonexistent' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /sessions/:id
// ═══════════════════════════════════════════════════════════════════════════
describe('DELETE /sessions/:id – response format', () => {
  let app: FastifyInstance;

  afterEach(() => app.close());

  it('204 with empty body on success', async () => {
    const liveSession = { id: 'del-1', role: 'qa', status: 'running' };
    const mgr = mockManager({ getSession: vi.fn().mockReturnValue(liveSession) });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'DELETE', url: '/sessions/del-1' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('404 with { error: string } when session does not exist', async () => {
    app = await buildSessionApp(mockManager(), mockStore());
    const res = await app.inject({ method: 'DELETE', url: '/sessions/ghost' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /sessions/:id/output
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /sessions/:id/output – response format', () => {
  let app: FastifyInstance;

  afterEach(() => app.close());

  it('returns { output: string, running: boolean } shape for a live running session', async () => {
    const liveSession = { id: 'run-1', role: 'backend', status: 'running' };
    const mgr = mockManager({
      getSession: vi.fn().mockReturnValue(liveSession),
      getSessionOutput: vi.fn().mockReturnValue({ output: 'line1\nline2', running: true }),
    });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/run-1/output' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('output');
    expect(body).toHaveProperty('running');
    expect(typeof body.output).toBe('string');
    expect(typeof body.running).toBe('boolean');
  });

  it('output is a string (not array) of newline-joined lines for a running session', async () => {
    const liveSession = { id: 'run-2', role: 'qa', status: 'running' };
    const mgr = mockManager({
      getSession: vi.fn().mockReturnValue(liveSession),
      getSessionOutput: vi.fn().mockReturnValue({ output: 'a\nb\nc', running: true }),
    });
    app = await buildSessionApp(mgr, mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/run-2/output' });
    expect(res.json().output).toBe('a\nb\nc');
    expect(Array.isArray(res.json().output)).toBe(false);
  });

  it('running is false for a completed session fetched from DB', async () => {
    const persisted = {
      id: 'done-1',
      role: 'backend',
      status: 'completed',
      pid: null,
      projectId: null,
      taskId: null,
      error: null,
      workingDir: '/tmp',
      prompt: 'x',
      cliProvider: null,
      executionMode: 'cloud',
      exitCode: 0,
      outputLog: 'all done',
      createdBy: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date('2024-01-01'),
    };
    const store = mockStore({ findById: vi.fn().mockResolvedValue(persisted) });
    app = await buildSessionApp(mockManager(), store);
    const res = await app.inject({ method: 'GET', url: '/sessions/done-1/output' });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(false);
  });

  it('404 with { error: string } when session does not exist anywhere', async () => {
    app = await buildSessionApp(mockManager(), mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/ghost-id/output' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('returns outputLog from DB for a completed session (buffer already cleared)', async () => {
    const persisted = {
      id: 'completed-1',
      role: 'mobile',
      status: 'completed',
      pid: null,
      projectId: 'proj-1',
      taskId: 'task-1',
      error: null,
      workingDir: '/work',
      prompt: 'build the app',
      cliProvider: null,
      executionMode: 'cloud',
      exitCode: 0,
      outputLog: 'Built successfully!',
      createdBy: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date('2024-06-01'),
    };
    const store = mockStore({ findById: vi.fn().mockResolvedValue(persisted) });
    // Session not in memory (evicted after completion)
    app = await buildSessionApp(mockManager(), store);
    const res = await app.inject({ method: 'GET', url: '/sessions/completed-1/output' });
    expect(res.statusCode).toBe(200);
    expect(res.json().output).toBe('Built successfully!');
    expect(res.json().running).toBe(false);
  });

  it('returns empty string output when DB has no outputLog for a completed session', async () => {
    const persisted = {
      id: 'no-log-1',
      role: 'devops',
      status: 'errored',
      pid: null,
      projectId: null,
      taskId: null,
      error: 'crashed',
      workingDir: '/work',
      prompt: 'deploy',
      cliProvider: null,
      executionMode: 'cloud',
      exitCode: 1,
      outputLog: null,
      createdBy: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date('2024-06-01'),
    };
    const store = mockStore({ findById: vi.fn().mockResolvedValue(persisted) });
    app = await buildSessionApp(mockManager(), store);
    const res = await app.inject({ method: 'GET', url: '/sessions/no-log-1/output' });
    expect(res.statusCode).toBe(200);
    expect(res.json().output).toBe('');
    expect(res.json().running).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// legacyStatus correctness (AgentStatus mapping)
// ═══════════════════════════════════════════════════════════════════════════
describe('legacyStatus field – data consistency', () => {
  it.each([
    ['pending', 'running'],
    ['running', 'running'],
    ['completed', 'idle'],
    ['errored', 'error'],
    ['killed', 'idle'],
  ] as [string, string][])('status %s → legacyStatus %s', async (status, expected) => {
    const sessions = [
      {
        id: 's',
        role: 'qa',
        status,
        legacyStatus: expected,
        pid: null,
        projectId: null,
        taskId: null,
      },
    ];
    const app = await buildSessionApp(
      mockManager({ listSessions: vi.fn().mockReturnValue(sessions) }),
      mockStore(),
    );
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.json()[0].legacyStatus).toBe(expected);
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /health/gemini  &  GET /health/cursor
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /health/gemini – response format', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    execFileMock.mockReset();
    app = await buildPromptApp();
  });
  afterEach(() => app.close());

  it('ok=true shape includes ok, loggedIn, version, cmd', async () => {
    execFileMock.mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
      cb(null, 'gemini/0.1.0\n', '');
    });
    const res = await app.inject({ method: 'GET', url: '/health/gemini' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('loggedIn');
    expect(body).toHaveProperty('version', 'gemini/0.1.0');
    expect(body).toHaveProperty('cmd', 'gemini');
    expect(typeof body.loggedIn).toBe('boolean');
  });

  it('ok=false when gemini binary missing', async () => {
    execFileMock.mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
      cb(new Error('ENOENT'));
    });
    const res = await app.inject({ method: 'GET', url: '/health/gemini' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.loggedIn).toBe(false);
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('cmd', 'gemini');
  });
});

describe('GET /health/cursor – response format', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    execFileMock.mockReset();
    app = await buildPromptApp();
  });
  afterEach(() => app.close());

  it('ok=true shape includes ok, loggedIn, version, cmd', async () => {
    execFileMock
      .mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
        cb(null, 'cursor-agent/2.0\n', ''); // --version
      })
      .mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
        cb(null, 'Logged in as user@example.com\n', ''); // status
      });
    const res = await app.inject({ method: 'GET', url: '/health/cursor' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.loggedIn).toBe('boolean');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('cmd');
  });

  it('ok=false when cursor binary missing', async () => {
    execFileMock.mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
      cb(new Error('ENOENT'));
    });
    const res = await app.inject({ method: 'GET', url: '/health/cursor' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body).toHaveProperty('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /prompt – additional format checks
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /prompt – response format completeness', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    execFileMock.mockReset();
    app = await buildPromptApp();
  });
  afterEach(() => app.close());

  it('200 response has only stdout field (no extra fields)', async () => {
    execFileMock.mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
      cb(null, '{"answer":42}', '');
    });
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'what is 6 * 7?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body)).toEqual(['stdout']);
    expect(body.stdout).toBe('{"answer":42}');
  });

  it('504 body has { error: string } on timeout', async () => {
    execFileMock.mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
      const err: any = new Error('timed out');
      err.killed = true;
      cb(err);
    });
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'slow query' },
    });
    expect(res.statusCode).toBe(504);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('500 body has { error: string } on buffer exceeded', async () => {
    execFileMock.mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => {
      const err: any = new Error('maxBuffer exceeded');
      err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      cb(err);
    });
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'generate huge output' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toHaveProperty('error');
  });

  it('timeoutMs must be positive and ≤ 120000; 400 otherwise', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/prompt',
      payload: { prompt: 'hi', timeoutMs: 200_000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error response consistency — all errors MUST be { error: string }
// ═══════════════════════════════════════════════════════════════════════════
describe('Error response shape consistency', () => {
  it('POST /sessions 400 returns { error: string }', async () => {
    const app = await buildSessionApp(mockManager(), mockStore());
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
    await app.close();
  });

  it('GET /sessions/:id 404 returns { error: string }', async () => {
    const app = await buildSessionApp(mockManager(), mockStore());
    const res = await app.inject({ method: 'GET', url: '/sessions/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
    await app.close();
  });

  it('DELETE /sessions/:id 404 returns { error: string }', async () => {
    const app = await buildSessionApp(mockManager(), mockStore());
    const res = await app.inject({ method: 'DELETE', url: '/sessions/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
    await app.close();
  });
});

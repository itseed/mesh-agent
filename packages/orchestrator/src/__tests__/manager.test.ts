import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { SessionManager } from '../manager.js';
import type { SessionStore, SessionRecord } from '../store.js';
import type { Streamer } from '../streamer.js';

function makeStubStore(): SessionStore & { _data: SessionRecord[] } {
  const data: SessionRecord[] = [];
  return {
    _data: data,
    async create(rec) {
      data.push(rec as SessionRecord);
    },
    async update(id, patch) {
      const idx = data.findIndex((r) => r.id === id);
      if (idx >= 0) data[idx] = { ...data[idx], ...patch } as SessionRecord;
    },
    async findById(id) {
      return data.find((r) => r.id === id) ?? null;
    },
    async findRunning() {
      return data.filter((r) => r.status === 'running' || r.status === 'pending');
    },
    async recordMetric() {},
    async updateTaskStage() {},
    async close() {},
  };
}

const stubStreamer: Streamer = {
  publishLine: vi.fn(),
  publishEvent: vi.fn(),
  close: async () => {},
} as unknown as Streamer;

describe('SessionManager', () => {
  let manager: SessionManager;
  let store: ReturnType<typeof makeStubStore>;

  beforeEach(() => {
    store = makeStubStore();
    manager = new SessionManager({
      claudeCmd: 'echo',
      defaultCliProvider: 'claude',
      store,
      streamer: stubStreamer,
      logger: pino({ level: 'silent' }),
      maxConcurrent: 4,
      idleTimeoutMs: 0,
    });
  });

  it('starts empty', () => {
    expect(manager.listSessions()).toEqual([]);
  });

  it('creates and persists a session', async () => {
    const session = await manager.createSession({
      role: 'frontend',
      workingDir: '/tmp',
      prompt: 'hi',
    });
    expect(session.role).toBe('frontend');
    expect(session.status).toBe('pending');
    expect(manager.listSessions()).toHaveLength(1);
    expect(store._data).toHaveLength(1);
    expect(store._data[0].id).toBe(session.id);
  });

  it('enforces concurrency limit', async () => {
    const m = new SessionManager({
      claudeCmd: 'sleep',
      defaultCliProvider: 'claude',
      store,
      streamer: stubStreamer,
      logger: pino({ level: 'silent' }),
      maxConcurrent: 1,
      idleTimeoutMs: 0,
    });
    const s = await m.createSession({ role: 'a', workingDir: '/tmp', prompt: '5' });
    s.start();
    await expect(m.createSession({ role: 'b', workingDir: '/tmp', prompt: '5' })).rejects.toThrow(
      /Concurrency limit/,
    );
    s.stop();
  });

  it('getSession returns session by id', async () => {
    const session = await manager.createSession({
      role: 'backend',
      workingDir: '/tmp',
      prompt: 'hi',
    });
    expect(manager.getSession(session.id)).toBe(session);
  });

  it('removeSession deletes from manager and marks killed in store', async () => {
    const session = await manager.createSession({
      role: 'qa',
      workingDir: '/tmp',
      prompt: 'hi',
    });
    await manager.removeSession(session.id);
    expect(manager.listSessions()).toHaveLength(0);
    const persisted = await store.findById(session.id);
    expect(persisted?.status).toBe('killed');
  });

  it('recoverFromCrash marks stale running sessions errored', async () => {
    store._data.push({
      id: 'orphan-1',
      role: 'frontend',
      workingDir: '/tmp',
      prompt: 'x',
      status: 'running',
    } as any);
    const recovered = await manager.recoverFromCrash();
    expect(recovered).toBe(1);
    const persisted = await store.findById('orphan-1');
    expect(persisted?.status).toBe('errored');
  });
});

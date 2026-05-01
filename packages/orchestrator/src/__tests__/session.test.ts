import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { AgentSession } from '../session.js';

// Interceptable spawn that delegates to the real spawn by default.
// A stable ref lets afterEach restore the pass-through after any per-test override.
const { mockSpawn, spawnRef } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  spawnRef: { fn: null as ((...a: any[]) => any) | null },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('node:child_process');
  spawnRef.fn = (...args: any[]) => (real.spawn as any)(...args);
  mockSpawn.mockImplementation(spawnRef.fn);
  return { ...real, spawn: mockSpawn };
});

afterEach(() => {
  // Restore pass-through so a failed test's leftover mockImplementationOnce
  // cannot cascade into the next test.
  if (spawnRef.fn) mockSpawn.mockImplementation(spawnRef.fn);
});

const baseOpts = {
  id: 'test',
  role: 'frontend',
  workingDir: '/tmp',
  prompt: 'hello',
  claudeCmd: 'echo',
};

describe('AgentSession', () => {
  it('has pending status on creation', () => {
    const session = new AgentSession({ ...baseOpts, id: 'test-1' });
    expect(session.status).toBe('pending');
    expect(session.id).toBe('test-1');
    expect(session.role).toBe('frontend');
  });

  it('transitions to completed when echo exits cleanly', async () => {
    const session = new AgentSession({ ...baseOpts, id: 'test-2', role: 'backend' });
    await session.start();
    expect(session.status).toBe('completed');
  });

  it('emits output for stdout lines', async () => {
    const session = new AgentSession({
      ...baseOpts,
      id: 'test-3',
      role: 'qa',
      prompt: 'test output',
    });
    const lines: string[] = [];
    session.on('output', (line) => lines.push(line));
    await session.start();
    expect(lines.length).toBeGreaterThan(0);
  });

  it('stop() marks the session killed', async () => {
    // Inject a fake long-running process so stop() can actually kill it.
    const proc = new EventEmitter() as any;
    proc.pid = 99;
    proc.killed = false;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn(() => {
      proc.killed = true;
      setImmediate(() => proc.emit('close', null));
    });
    mockSpawn.mockImplementationOnce(() => proc);

    const session = new AgentSession({
      ...baseOpts,
      id: 'test-4',
      claudeCmd: 'irrelevant',
      prompt: 'anything',
    });
    const startPromise = session.start();
    await new Promise((r) => setTimeout(r, 50));
    session.stop();
    await startPromise;
    expect(session.status).toBe('killed');
  });

  it('emits end event with metrics', async () => {
    const session = new AgentSession({ ...baseOpts, id: 'test-5' });
    const onEnd = vi.fn();
    session.on('end', onEnd);
    await session.start();
    expect(onEnd).toHaveBeenCalledOnce();
    const metrics = onEnd.mock.calls[0][0];
    expect(metrics.outputBytes).toBeGreaterThan(0);
    expect(metrics.success).toBe(true);
  });
});

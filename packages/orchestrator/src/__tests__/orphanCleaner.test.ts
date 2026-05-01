import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileMock } = vi.hoisted(() => {
  const { promisify } = require('node:util');
  const execFileMock = vi.fn();
  (execFileMock as any)[promisify.custom] = (...args: any[]) => {
    return new Promise((resolve, reject) => {
      const cb = (err: any, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      };
      execFileMock(...args, cb);
    });
  };
  return { execFileMock };
});

vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { cleanOrphanWorktrees } from '../orphanCleaner.js';

const mockLogger = { info: vi.fn(), warn: vi.fn() } as any;

function makeDir(name: string) {
  return { name, isDirectory: () => true, isFile: () => false } as any;
}

describe('cleanOrphanWorktrees', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    vi.mocked(existsSync).mockReset();
    vi.mocked(readdir).mockReset();
  });

  it('does nothing when reposBaseDir does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    await cleanOrphanWorktrees('/repos', new Set(), mockLogger);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('removes orphan worktree not in activeTaskIds', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => true);
    vi.mocked(readdir)
      .mockResolvedValueOnce([makeDir('proj-1')]) // projectDirs
      .mockResolvedValueOnce([makeDir('my-repo')]) // repoDirs
      .mockResolvedValueOnce([makeDir('orphan-task-id')]); // worktreeDirs
    execFileMock
      .mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => cb(null, '', '')) // worktree remove
      .mockImplementationOnce((_c: any, _a: any, _o: any, cb: Function) => cb(null, '', '')); // branch -D
    await cleanOrphanWorktrees('/repos', new Set(['active-task']), mockLogger);
    expect(execFileMock).toHaveBeenCalledTimes(2);
    const firstCall = execFileMock.mock.calls[0];
    expect(firstCall[1]).toContain('worktree');
    expect(firstCall[1]).toContain('remove');
  });

  it('skips active worktrees', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir)
      .mockResolvedValueOnce([makeDir('proj-1')])
      .mockResolvedValueOnce([makeDir('my-repo')])
      .mockResolvedValueOnce([makeDir('active-task-id')]);
    await cleanOrphanWorktrees('/repos', new Set(['active-task-id']), mockLogger);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

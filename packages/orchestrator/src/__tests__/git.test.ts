import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use the same promisify.custom mock pattern as prompt.test.ts
const { execFileMock } = vi.hoisted(() => {
  const { promisify } = require('node:util')
  const execFileMock = vi.fn()
  ;(execFileMock as any)[promisify.custom] = (...args: any[]) => {
    return new Promise((resolve, reject) => {
      const cb = (err: any, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      }
      execFileMock(...args, cb)
    })
  }
  return { execFileMock }
})

vi.mock('node:child_process', () => ({ execFile: execFileMock }))
vi.mock('node:fs', () => ({ existsSync: vi.fn() }))
vi.mock('node:fs/promises', () => ({ rm: vi.fn().mockResolvedValue(undefined) }))

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { ensureRepo, createWorktree, removeWorktree, removeProjectDir } from '../git.js'

function okCb(stdout = ''): (_cmd: any, _args: any, _opts: any, cb: Function) => void {
  return (_cmd, _args, _opts, cb) => cb(null, stdout, '')
}
function errCb(msg: string): (_cmd: any, _args: any, _opts: any, cb: Function) => void {
  return (_cmd, _args, _opts, cb) => cb(new Error(msg))
}

describe('ensureRepo', () => {
  beforeEach(() => execFileMock.mockReset())

  it('clones when workingDir does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    execFileMock.mockImplementationOnce(okCb())
    await ensureRepo('/repos/proj/my-repo', 'https://github.com/owner/repo.git')
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '50', 'https://github.com/owner/repo.git', '/repos/proj/my-repo'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('pulls when workingDir exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    execFileMock.mockImplementationOnce(okCb())
    await ensureRepo('/repos/proj/my-repo', 'https://github.com/owner/repo.git')
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['-C', '/repos/proj/my-repo', 'pull', '--ff-only'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('does not throw when pull fails (conflict) — swallows error', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    execFileMock.mockImplementationOnce(errCb('CONFLICT'))
    await expect(ensureRepo('/repos/proj/my-repo', 'https://example.com/repo.git')).resolves.toBeUndefined()
  })

  it('throws when clone fails', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    execFileMock.mockImplementationOnce(errCb('Authentication failed'))
    await expect(ensureRepo('/repos/proj/my-repo', 'https://example.com/repo.git')).rejects.toThrow('Authentication failed')
  })
})

describe('createWorktree', () => {
  beforeEach(() => execFileMock.mockReset())

  it('runs git worktree add and returns path', async () => {
    execFileMock.mockImplementationOnce(okCb())
    const result = await createWorktree('/repos/proj/my-repo', 'task-abc')
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['-C', '/repos/proj/my-repo', 'worktree', 'add',
       '/repos/proj/my-repo/worktrees/task-abc', '-b', 'task/task-abc'],
      expect.any(Object),
      expect.any(Function),
    )
    expect(result).toBe('/repos/proj/my-repo/worktrees/task-abc')
  })

  it('throws when worktree add fails', async () => {
    execFileMock.mockImplementationOnce(errCb('already exists'))
    await expect(createWorktree('/repos/proj/my-repo', 'task-dup')).rejects.toThrow('already exists')
  })
})

describe('removeWorktree', () => {
  beforeEach(() => execFileMock.mockReset())

  it('calls worktree remove and branch delete', async () => {
    execFileMock
      .mockImplementationOnce(okCb())  // worktree remove
      .mockImplementationOnce(okCb())  // branch -D
    await removeWorktree('/repos/proj/my-repo', 'task-abc')
    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(execFileMock).toHaveBeenNthCalledWith(
      1, 'git',
      ['-C', '/repos/proj/my-repo', 'worktree', 'remove',
       '/repos/proj/my-repo/worktrees/task-abc', '--force'],
      expect.any(Object), expect.any(Function),
    )
    expect(execFileMock).toHaveBeenNthCalledWith(
      2, 'git',
      ['-C', '/repos/proj/my-repo', 'branch', '-D', 'task/task-abc'],
      expect.any(Object), expect.any(Function),
    )
  })

  it('does not throw when both commands fail (idempotent)', async () => {
    execFileMock
      .mockImplementationOnce(errCb('not found'))
      .mockImplementationOnce(errCb('no such branch'))
    await expect(removeWorktree('/repos/proj/my-repo', 'task-gone')).resolves.toBeUndefined()
  })
})

describe('removeProjectDir', () => {
  it('calls rm with recursive + force on {reposBaseDir}/{projectId}', async () => {
    vi.mocked(rm).mockResolvedValue(undefined)
    await removeProjectDir('/repos', 'proj-123')
    expect(rm).toHaveBeenCalledWith('/repos/proj-123', { recursive: true, force: true })
  })
})

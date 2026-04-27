import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export async function ensureRepo(workingDir: string, repoUrl: string): Promise<void> {
  if (!existsSync(workingDir)) {
    await execFileAsync('git', ['clone', '--depth', '50', repoUrl, workingDir], {})
  } else {
    try {
      await execFileAsync('git', ['-C', workingDir, 'pull', '--ff-only'], {})
    } catch {
      // existing clone stays; caller logs warning if needed
    }
  }
}

export async function createWorktree(workingDir: string, taskId: string): Promise<string> {
  const worktreePath = path.join(workingDir, 'worktrees', taskId)
  await execFileAsync(
    'git',
    ['-C', workingDir, 'worktree', 'add', worktreePath, '-b', `task/${taskId}`],
    {},
  )
  return worktreePath
}

export async function removeWorktree(workingDir: string, taskId: string): Promise<void> {
  const worktreePath = path.join(workingDir, 'worktrees', taskId)
  try {
    await execFileAsync('git', ['-C', workingDir, 'worktree', 'remove', worktreePath, '--force'], {})
  } catch { }
  try {
    await execFileAsync('git', ['-C', workingDir, 'branch', '-D', `task/${taskId}`], {})
  } catch { }
}

export async function removeProjectDir(reposBaseDir: string, projectId: string): Promise<void> {
  await rm(path.join(reposBaseDir, projectId), { recursive: true, force: true })
}

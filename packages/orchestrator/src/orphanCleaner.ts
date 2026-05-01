import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type pino from 'pino';

const execFileAsync = promisify(execFile);

export async function cleanOrphanWorktrees(
  reposBaseDir: string,
  activeTaskIds: Set<string>,
  logger: pino.Logger,
): Promise<void> {
  if (!existsSync(reposBaseDir)) return;

  const projectEntries: Dirent[] = await readdir(reposBaseDir, { withFileTypes: true });
  const projectDirs = projectEntries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(reposBaseDir, e.name));

  for (const projectDir of projectDirs) {
    const repoEntries: Dirent[] = await readdir(projectDir, { withFileTypes: true }).catch(
      () => [],
    );
    const repoDirs = repoEntries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(projectDir, e.name));

    for (const repoDir of repoDirs) {
      const worktreesDir = path.join(repoDir, 'worktrees');
      if (!existsSync(worktreesDir)) continue;

      const worktreeEntries: Dirent[] = await readdir(worktreesDir, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of worktreeEntries.filter((e) => e.isDirectory())) {
        const taskId = entry.name;
        if (!activeTaskIds.has(taskId)) {
          logger.info({ taskId, repoDir }, 'Removing orphan worktree');
          try {
            await execFileAsync(
              'git',
              ['-C', repoDir, 'worktree', 'remove', path.join(worktreesDir, taskId), '--force'],
              {},
            );
          } catch {}
          try {
            await execFileAsync('git', ['-C', repoDir, 'branch', '-D', `task/${taskId}`], {});
          } catch {}
        }
      }
    }
  }
}

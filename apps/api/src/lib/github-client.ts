import { Octokit } from '@octokit/rest'
import type Redis from 'ioredis'
import { env } from '../env.js'
import { decryptSecret, isEncrypted } from './crypto.js'

export const TOKEN_KEY = 'settings:github:token'

let _envClient: Octokit | null = null

export function getGitHubClient(): Octokit {
  if (!_envClient) {
    _envClient = new Octokit({ auth: env.GITHUB_TOKEN })
  }
  return _envClient
}

export async function readStoredToken(redis: Redis): Promise<string | null> {
  const raw = await redis.get(TOKEN_KEY)
  if (!raw) return null
  try {
    return isEncrypted(raw) ? decryptSecret(raw) : raw
  } catch {
    return null
  }
}

export async function resolveGitHubClient(redis?: Redis): Promise<Octokit> {
  if (redis) {
    const stored = await readStoredToken(redis)
    if (stored) return new Octokit({ auth: stored })
  }
  return getGitHubClient()
}

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export function parseRepo(repoSlug: string): { owner: string; repo: string } {
  if (!REPO_RE.test(repoSlug)) {
    throw new Error(`Invalid repo format: ${repoSlug}. Use "owner/repo"`)
  }
  const [owner, repo] = repoSlug.split('/')
  return { owner, repo }
}

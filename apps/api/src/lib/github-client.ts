import { Octokit } from '@octokit/rest'
import type Redis from 'ioredis'
import { env } from '../env.js'

const TOKEN_KEY = 'settings:github:token'

let _envClient: Octokit | null = null

export function getGitHubClient(): Octokit {
  if (!_envClient) {
    _envClient = new Octokit({ auth: env.GITHUB_TOKEN })
  }
  return _envClient
}

/**
 * Resolve the active GitHub client by preferring a user-stored token (set via the
 * Settings page) and falling back to the GITHUB_TOKEN env var.
 */
export async function resolveGitHubClient(redis?: Redis): Promise<Octokit> {
  if (redis) {
    const stored = await redis.get(TOKEN_KEY)
    if (stored) return new Octokit({ auth: stored })
  }
  return getGitHubClient()
}

export function parseRepo(repoSlug: string): { owner: string; repo: string } {
  const [owner, repo] = repoSlug.split('/')
  if (!owner || !repo) throw new Error(`Invalid repo format: ${repoSlug}. Use "owner/repo"`)
  return { owner, repo }
}

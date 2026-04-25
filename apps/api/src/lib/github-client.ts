import { Octokit } from '@octokit/rest'
import { env } from '../env.js'

let _client: Octokit | null = null

export function getGitHubClient(): Octokit {
  if (!_client) {
    _client = new Octokit({ auth: env.GITHUB_TOKEN })
  }
  return _client
}

export function parseRepo(repoSlug: string): { owner: string; repo: string } {
  const [owner, repo] = repoSlug.split('/')
  if (!owner || !repo) throw new Error(`Invalid repo format: ${repoSlug}. Use "owner/repo"`)
  return { owner, repo }
}

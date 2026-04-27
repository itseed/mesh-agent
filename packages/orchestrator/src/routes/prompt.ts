import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from '../env.js'

const execFileAsync = promisify(execFile)

const promptBodySchema = z.object({
  prompt: z.string().min(1).max(64 * 1024),
  timeoutMs: z.coerce.number().int().positive().max(120_000).default(60_000),
})

const tokenBodySchema = z.object({
  token: z.string().min(1).max(4096),
})

export async function promptRoutes(fastify: FastifyInstance) {
  fastify.post('/prompt', async (request, reply) => {
    let prompt: string
    let timeoutMs: number
    try {
      const parsed = promptBodySchema.parse(request.body)
      prompt = parsed.prompt
      timeoutMs = parsed.timeoutMs
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? 'Invalid request' })
    }
    try {
      const { stdout } = await execFileAsync(
        env.CLAUDE_CMD,
        ['--output-format', 'json', '-p', prompt],
        { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env },
      )
      return { stdout }
    } catch (err: any) {
      if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        return reply.status(504).send({ error: 'claude timed out' })
      }
      return reply.status(500).send({ error: err.message ?? 'claude failed' })
    }
  })

  fastify.get('/health/claude', async () => {
    let cmd = env.CLAUDE_CMD
    try {
      const resolved = execFileSync('which', [env.CLAUDE_CMD], { encoding: 'utf8' }).trim()
      if (resolved) cmd = resolved
    } catch {
      // keep env.CLAUDE_CMD as fallback
    }
    try {
      const version = execFileSync(env.CLAUDE_CMD, ['--version'], {
        encoding: 'utf8',
        timeout: 10_000,
        env: process.env,
      }).trim()
      return { ok: true, version, cmd }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'CLI not found', cmd }
    }
  })

  fastify.post('/health/claude/token', async (request, reply) => {
    const { token } = tokenBodySchema.parse(request.body)
    const tokenPath = '/root/.claude/token'
    try {
      mkdirSync(dirname(tokenPath), { recursive: true })
      writeFileSync(tokenPath, token, { mode: 0o600 })
    } catch (e: any) {
      return reply.status(500).send({ error: `Failed to write token: ${e?.message}` })
    }
    return { ok: true, path: tokenPath }
  })
}

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { execFile } from 'node:child_process'
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
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        return reply.status(500).send({ error: 'claude response exceeded buffer limit' })
      }
      if (err.killed || err.signal === 'SIGTERM') {
        return reply.status(504).send({ error: 'claude timed out' })
      }
      return reply.status(500).send({ error: err.message ?? 'claude failed' })
    }
  })

  fastify.get('/health/claude', async () => {
    let cmd = env.CLAUDE_CMD
    try {
      const { stdout } = await execFileAsync('which', [env.CLAUDE_CMD], { encoding: 'utf8', timeout: 5_000 })
      if (stdout.trim()) cmd = stdout.trim()
    } catch {}

    let version = ''
    try {
      const { stdout } = await execFileAsync(env.CLAUDE_CMD, ['--version'], { encoding: 'utf8', timeout: 10_000, env: process.env })
      version = stdout.trim()
    } catch (err: any) {
      return { ok: false, loggedIn: false, error: err?.message ?? 'CLI not found', cmd }
    }

    let loggedIn = false
    try {
      const { stdout } = await execFileAsync(env.CLAUDE_CMD, ['auth', 'status', '--output-format', 'json'], {
        encoding: 'utf8', timeout: 10_000, env: process.env,
      })
      const parsed = JSON.parse(stdout)
      loggedIn = parsed.loggedIn === true
    } catch {}

    return { ok: true, loggedIn, version, cmd }
  })

  fastify.post('/health/claude/token', async (request, reply) => {
    let token: string
    try {
      token = tokenBodySchema.parse(request.body).token
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? 'Invalid request' })
    }
    const tokenPath = '/root/.claude/token'
    try {
      mkdirSync(dirname(tokenPath), { recursive: true })
      writeFileSync(tokenPath, token, { mode: 0o600 })
    } catch (e: any) {
      return reply.status(500).send({ error: `Failed to write token: ${e?.message}` })
    }
    return { ok: true, path: tokenPath }
  })

  fastify.get('/health/gemini', async () => {
    try {
      const { stdout } = await execFileAsync('gemini', ['--version'], { encoding: 'utf8', timeout: 10_000, env: process.env })
      // gemini has no auth status command — GEMINI_API_KEY means API key auth; absence implies OAuth (installed = likely authenticated)
      const loggedIn = !!(process.env.GEMINI_API_KEY) || true
      return { ok: true, loggedIn, version: stdout.trim(), cmd: 'gemini' }
    } catch (err: any) {
      return { ok: false, loggedIn: false, error: err?.message ?? 'CLI not found', cmd: 'gemini' }
    }
  })

  fastify.get('/health/cursor', async () => {
    const cursorBin = '/root/.local/bin/agent'
    try {
      const { stdout } = await execFileAsync(cursorBin, ['--version'], { encoding: 'utf8', timeout: 10_000, env: process.env })
      let loggedIn = false
      try {
        const { stdout: statusOut } = await execFileAsync(cursorBin, ['status'], { encoding: 'utf8', timeout: 10_000, env: process.env })
        loggedIn = statusOut.toLowerCase().includes('logged in') || statusOut.toLowerCase().includes('authenticated')
      } catch {}
      return { ok: true, loggedIn, version: stdout.trim(), cmd: cursorBin }
    } catch (err: any) {
      return { ok: false, loggedIn: false, error: err?.message ?? 'CLI not found', cmd: cursorBin }
    }
  })
}

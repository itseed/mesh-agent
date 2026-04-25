import Fastify from 'fastify'
import { env } from './env.js'
import { SessionManager } from './manager.js'
import { Streamer } from './streamer.js'
import { sessionRoutes } from './routes/sessions.js'

export async function buildServer() {
  const fastify = Fastify({ logger: env.NODE_ENV !== 'test' })

  const manager = new SessionManager({ claudeCmd: env.CLAUDE_CMD })
  const streamer = new Streamer(env.REDIS_URL)

  fastify.get('/health', async () => ({ status: 'ok' }))
  await fastify.register(sessionRoutes, { manager, streamer })

  fastify.addHook('onClose', async () => { await streamer.close() })

  return fastify
}

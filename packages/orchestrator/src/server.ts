import Fastify from 'fastify'
import pino from 'pino'
import { env } from './env.js'
import { SessionManager } from './manager.js'
import { Streamer } from './streamer.js'
import { sessionRoutes } from './routes/sessions.js'
import { createSessionStore } from './store.js'

const isTest = env.NODE_ENV === 'test'
const isProd = env.NODE_ENV === 'production'

export async function buildServer() {
  const logger = pino({
    level: isTest ? 'silent' : env.LOG_LEVEL,
    ...(isProd
      ? {}
      : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  })

  const fastify = Fastify({ logger: isTest ? false : logger })

  const store = createSessionStore(env.DATABASE_URL)
  const streamer = new Streamer(env.REDIS_URL)
  const manager = new SessionManager({
    claudeCmd: env.CLAUDE_CMD,
    store,
    streamer,
    logger: logger as any,
    maxConcurrent: env.MAX_CONCURRENT_SESSIONS,
    idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_MS,
  })

  if (env.DATABASE_URL && !isTest) {
    await manager.recoverFromCrash().catch((err) => {
      fastify.log.error({ err }, 'Crash recovery failed')
    })
  }

  fastify.get('/health', async () => ({
    status: 'ok',
    activeSessions: manager.activeCount,
    maxConcurrent: env.MAX_CONCURRENT_SESSIONS,
  }))
  fastify.get('/metrics/concurrency', async () => ({
    active: manager.activeCount,
    max: env.MAX_CONCURRENT_SESSIONS,
    sessions: manager.listSessions().map((s) => ({
      id: s.id,
      role: s.role,
      status: s.status,
    })),
  }))

  await fastify.register(sessionRoutes, { manager, store })

  fastify.addHook('onClose', async () => {
    await manager.shutdown()
    await streamer.close()
    await store.close()
  })

  return fastify
}

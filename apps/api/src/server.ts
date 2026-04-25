import Fastify, { FastifyRequest, FastifyReply } from 'fastify'
import fjwt from '@fastify/jwt'
import cors from '@fastify/cors'
import { env } from './env.js'
import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'
import { authRoutes } from './routes/auth.js'
import { taskRoutes } from './routes/tasks.js'
import { projectRoutes } from './routes/projects.js'
import { agentRoutes } from './routes/agents.js'
import { wsHandler } from './ws/handler.js'
import { githubRoutes } from './routes/github.js'
import { settingsRoutes } from './routes/settings.js'
import { chatRoutes } from './routes/chat.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export async function buildServer() {
  const fastify = Fastify({
    logger: env.NODE_ENV !== 'test',
    bodyLimit: 25 * 1024 * 1024, // 25MB to allow image attachments
  })

  await fastify.register(cors, { origin: true, credentials: true })
  await fastify.register(fjwt, { secret: env.JWT_SECRET })

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  await fastify.register(dbPlugin)
  await fastify.register(redisPlugin)
  await fastify.register(authRoutes)
  await fastify.register(taskRoutes)
  await fastify.register(projectRoutes)
  await fastify.register(agentRoutes)
  await fastify.register(wsHandler)
  await fastify.register(githubRoutes)
  await fastify.register(settingsRoutes)
  await fastify.register(chatRoutes)

  fastify.get('/health', async () => ({ status: 'ok' }))

  return fastify
}

import Fastify, { FastifyRequest, FastifyReply } from 'fastify'
import fjwt from '@fastify/jwt'
import { env } from './env.js'
import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'
import { authRoutes } from './routes/auth.js'
import { taskRoutes } from './routes/tasks.js'
import { projectRoutes } from './routes/projects.js'
import { agentRoutes } from './routes/agents.js'
import { wsHandler } from './ws/handler.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export async function buildServer() {
  const fastify = Fastify({
    logger: env.NODE_ENV !== 'test',
  })

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

  fastify.get('/health', async () => ({ status: 'ok' }))

  return fastify
}

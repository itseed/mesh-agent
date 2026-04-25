import fp from 'fastify-plugin'
import Redis from 'ioredis'
import { env } from '../env.js'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

export default fp(async (fastify) => {
  const redis = new Redis(env.REDIS_URL)
  fastify.decorate('redis', redis)
  fastify.addHook('onClose', async () => { redis.disconnect() })
})

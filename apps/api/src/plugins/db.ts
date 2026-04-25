import fp from 'fastify-plugin'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from '@meshagent/shared'

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>
  }
}

export default fp(async (fastify) => {
  const client = postgres(env.DATABASE_URL)
  const db = drizzle(client, { schema })
  fastify.decorate('db', db)
  fastify.addHook('onClose', async () => { await client.end() })
})

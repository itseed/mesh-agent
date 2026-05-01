import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from '@meshagent/shared';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>;
    pg: ReturnType<typeof postgres>;
  }
}

export default fp(async (fastify) => {
  const client = postgres(env.DATABASE_URL, {
    max: env.DB_POOL_MAX,
    idle_timeout: env.DB_POOL_IDLE_TIMEOUT,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  fastify.decorate('db', db);
  fastify.decorate('pg', client);
  fastify.addHook('onClose', async () => {
    await client.end({ timeout: 5 });
  });
});

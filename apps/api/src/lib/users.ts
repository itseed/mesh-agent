import bcrypt from 'bcryptjs'
import { eq, sql } from 'drizzle-orm'
import { users } from '@meshagent/shared'
import type { FastifyInstance } from 'fastify'
import { env } from '../env.js'

const BCRYPT_ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function findUserByEmail(fastify: FastifyInstance, email: string) {
  const [user] = await fastify.db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1)
  return user ?? null
}

export async function touchLastLogin(fastify: FastifyInstance, userId: string): Promise<void> {
  await fastify.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))
}

export async function ensureSeedUser(fastify: FastifyInstance): Promise<void> {
  const [{ count }] = await fastify.db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
  if (count > 0) return

  const passwordHash = await hashPassword(env.AUTH_PASSWORD)
  await fastify.db.insert(users).values({
    email: env.AUTH_EMAIL.toLowerCase().trim(),
    passwordHash,
    role: 'admin',
    isActive: true,
  })
  fastify.log.info({ email: env.AUTH_EMAIL }, 'Seeded initial admin user from env')
}

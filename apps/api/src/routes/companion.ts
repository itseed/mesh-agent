import crypto from 'node:crypto'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { SocketStream } from '@fastify/websocket'
import bcrypt from 'bcryptjs'
import { companionTokens } from '@meshagent/shared'
import { companionManager } from '../lib/companionManager.js'

const SALT_ROUNDS = 10

function generateToken(): { token: string; prefix: string; hash: string } {
  const raw = `mesh_comp_${crypto.randomBytes(16).toString('hex')}`
  const prefix = raw.slice(0, 20)
  const hash = bcrypt.hashSync(raw, SALT_ROUNDS)
  return { token: raw, prefix, hash }
}

export async function companionRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  fastify.get('/companion/tokens', { preHandler }, async (request) => {
    const { id: userId } = request.user as { id: string }
    return fastify.db
      .select({
        id: companionTokens.id,
        label: companionTokens.label,
        prefix: companionTokens.prefix,
        createdAt: companionTokens.createdAt,
        lastSeenAt: companionTokens.lastSeenAt,
      })
      .from(companionTokens)
      .where(eq(companionTokens.userId, userId))
  })

  fastify.post('/companion/tokens', { preHandler }, async (request, reply) => {
    const { id: userId } = request.user as { id: string }
    const { label } = z.object({ label: z.string().min(1).max(100).default('default') }).parse(request.body)
    const { token, prefix, hash } = generateToken()
    const [row] = await fastify.db
      .insert(companionTokens)
      .values({ userId, label, tokenHash: hash, prefix })
      .returning({ id: companionTokens.id, prefix: companionTokens.prefix })
    return reply.status(201).send({ id: row.id, prefix: row.prefix, token })
  })

  fastify.delete('/companion/tokens/:id', { preHandler }, async (request, reply) => {
    const { id: userId } = request.user as { id: string }
    const { id } = request.params as { id: string }
    const deleted = await fastify.db
      .delete(companionTokens)
      .where(and(eq(companionTokens.id, id), eq(companionTokens.userId, userId)))
      .returning({ id: companionTokens.id })
    if (deleted.length === 0) return reply.status(404).send({ error: 'Token not found' })
    return reply.send({ ok: true })
  })

  fastify.get('/companion/status', { preHandler }, async (request) => {
    const { id: userId } = request.user as { id: string }
    const conn = companionManager.getConnection(userId)
    return { connected: !!conn, connectedAt: conn?.connectedAt ?? null }
  })

  fastify.get('/ws/companion', { websocket: true }, async (connection: SocketStream, request) => {
    const authHeader = (request.headers['authorization'] as string | undefined) ?? ''
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!rawToken.startsWith('mesh_comp_')) {
      connection.socket.close(1008, 'Unauthorized')
      return
    }

    // Use prefix to narrow DB lookup before expensive bcrypt compare
    const prefix = rawToken.slice(0, 20)
    const rows = await fastify.db
      .select()
      .from(companionTokens)
      .where(eq(companionTokens.prefix, prefix))
    let match: typeof rows[number] | undefined
    for (const row of rows) {
      if (await bcrypt.compare(rawToken, row.tokenHash)) {
        match = row
        break
      }
    }

    if (!match) {
      connection.socket.close(1008, 'Unauthorized')
      return
    }

    companionManager.register(match.id, match.userId, connection)
    await fastify.db
      .update(companionTokens)
      .set({ lastSeenAt: new Date() })
      .where(eq(companionTokens.id, match.id))
    await fastify.redis.publish(
      'companion:events',
      JSON.stringify({ type: 'companion.connected', userId: match.userId }),
    )

    connection.socket.on('message', (raw: Buffer) => {
      companionManager.handleResponse(raw.toString())
      fastify.db
        .update(companionTokens)
        .set({ lastSeenAt: new Date() })
        .where(eq(companionTokens.id, match.id))
        .catch(() => {})
    })

    connection.socket.on('close', async () => {
      companionManager.unregister(match.id)
      await fastify.redis.publish(
        'companion:events',
        JSON.stringify({ type: 'companion.disconnected', userId: match.userId }),
      )
    })
  })
}

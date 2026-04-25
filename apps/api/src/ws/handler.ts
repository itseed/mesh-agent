import { FastifyInstance } from 'fastify'
import { SocketStream } from '@fastify/websocket'
import Redis from 'ioredis'
import { env } from '../env.js'

export async function wsHandler(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/websocket'))

  // GET /ws?sessionId=xxx — subscribe to agent output
  fastify.get('/ws', { websocket: true }, (connection: SocketStream, request) => {
    const { sessionId } = request.query as { sessionId?: string }
    if (!sessionId) {
      connection.socket.close(1008, 'sessionId required')
      return
    }

    const subscriber = new Redis(env.REDIS_URL)
    const channel = `agent:${sessionId}:output`

    subscriber.subscribe(channel)
    subscriber.on('message', (_, message) => {
      if (connection.socket.readyState === connection.socket.OPEN) {
        connection.socket.send(message)
      }
    })

    connection.socket.on('close', () => {
      subscriber.unsubscribe(channel)
      subscriber.disconnect()
    })
  })
}

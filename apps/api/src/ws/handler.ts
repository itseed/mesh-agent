import { FastifyInstance } from 'fastify'
import Redis from 'ioredis'
import { env } from '../env.js'

export async function wsHandler(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/websocket'))

  // GET /ws?sessionId=xxx — subscribe to agent output
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    const { sessionId } = request.query as { sessionId?: string }
    if (!sessionId) {
      socket.close(1008, 'sessionId required')
      return
    }

    const subscriber = new Redis(env.REDIS_URL)
    const channel = `agent:${sessionId}:output`

    subscriber.subscribe(channel)
    subscriber.on('message', (_, message) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(message)
      }
    })

    socket.on('close', () => {
      subscriber.unsubscribe(channel)
      subscriber.disconnect()
    })
  })
}

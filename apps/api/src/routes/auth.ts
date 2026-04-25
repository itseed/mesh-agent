import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../env.js'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)

    if (body.email !== env.AUTH_EMAIL || body.password !== env.AUTH_PASSWORD) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const token = fastify.jwt.sign({ email: body.email }, { expiresIn: '30d' })
    return { token }
  })

  fastify.get(
    '/auth/me',
    { preHandler: [fastify.authenticate] },
    async (request) => {
      return { email: (request.user as { email: string }).email }
    },
  )
}

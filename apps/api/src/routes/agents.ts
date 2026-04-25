import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../env.js'

const dispatchSchema = z.object({
  role: z.enum(['frontend', 'backend', 'mobile', 'devops', 'designer', 'qa', 'reviewer']),
  workingDir: z.string(),
  prompt: z.string().min(1),
})

export async function agentRoutes(fastify: FastifyInstance) {
  const preHandler = [fastify.authenticate]

  fastify.get('/agents', { preHandler }, async (_, reply) => {
    const res = await fetch(`${env.ORCHESTRATOR_URL}/sessions`)
    if (!res.ok) return reply.status(502).send({ error: 'Orchestrator unavailable' })
    return res.json()
  })

  fastify.post('/agents', { preHandler }, async (request, reply) => {
    const body = dispatchSchema.parse(request.body)
    const res = await fetch(`${env.ORCHESTRATOR_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return reply.status(502).send({ error: 'Orchestrator unavailable' })
    reply.status(201)
    return res.json()
  })

  fastify.delete('/agents/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await fetch(`${env.ORCHESTRATOR_URL}/sessions/${id}`, { method: 'DELETE' })
    reply.status(204)
  })
}

import { z } from 'zod'

const envSchema = z.object({
  REDIS_URL: z.string().url(),
  PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLAUDE_CMD: z.string().default('claude'),
})

export const env = envSchema.parse(process.env)

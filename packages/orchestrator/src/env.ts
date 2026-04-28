import { z } from 'zod'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '../../.env') })

const envSchema = z.object({
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().url().optional(),
  ORCHESTRATOR_PORT: z.coerce.number().default(3002),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLAUDE_CMD: z.string().default('claude'),
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(8),
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(60 * 60 * 1000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_SECRET: z.string().default('dev-internal-secret'),
  REPOS_BASE_DIR: z.string().default('/repos'),
  DEFAULT_CLI_PROVIDER: z.enum(['claude', 'gemini', 'cursor']).default('claude'),
})

export const env = envSchema.parse(process.env)

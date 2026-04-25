import { z } from 'zod'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '../../.env') })

const csv = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().int().nonnegative().default(30),
  REDIS_URL: z.string().url(),
  AUTH_EMAIL: z.string().email(),
  AUTH_PASSWORD: z.string().min(8),
  JWT_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ORCHESTRATOR_URL: z.string().url().default('http://localhost:3002'),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(16).optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_REDIRECT_URI: z.string().url().optional(),
  WEB_BASE_URL: z.string().url().optional(),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) => csv(v)),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  COOKIE_DOMAIN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

const parsed = envSchema.parse(process.env)

if (parsed.NODE_ENV === 'production') {
  if (!parsed.GITHUB_WEBHOOK_SECRET) {
    throw new Error(
      'GITHUB_WEBHOOK_SECRET is required in production (min 16 chars). Generate one: openssl rand -hex 32',
    )
  }
  if (parsed.CORS_ALLOWED_ORIGINS.length === 0) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS is required in production. Example: https://app.example.com,https://admin.example.com',
    )
  }
}

export const env = parsed
export const isProd = parsed.NODE_ENV === 'production'
export const isTest = parsed.NODE_ENV === 'test'

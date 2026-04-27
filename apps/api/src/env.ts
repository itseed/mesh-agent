import { z } from 'zod'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '../../.env') })

const csv = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

// Empty strings from .env should be treated as "not set"
const optStr = (minLen?: number) =>
  z.preprocess(
    (v) => (!v ? undefined : v),
    minLen ? z.string().min(minLen).optional() : z.string().optional(),
  )

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
  INTERNAL_SECRET: z.string().default('dev-internal-secret'),
  API_URL: z.string().url().default('http://localhost:3001'),
  GITHUB_TOKEN: optStr(),
  GITHUB_WEBHOOK_SECRET: optStr(16),
  GITHUB_OAUTH_CLIENT_ID: optStr(),
  GITHUB_OAUTH_CLIENT_SECRET: optStr(),
  GITHUB_OAUTH_REDIRECT_URI: z.preprocess((v) => (!v ? undefined : v), z.string().url().optional()),
  WEB_BASE_URL: z.preprocess((v) => (!v ? undefined : v), z.string().url().optional()),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) => csv(v)),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  COOKIE_DOMAIN: optStr(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MINIO_ENDPOINT: optStr(),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: optStr(),
  MINIO_SECRET_KEY: optStr(),
  MINIO_USE_SSL: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).default(false),
  MINIO_BUCKET: z.string().default('mesh-agent'),
  CLAUDE_CMD: z.string().default('claude'),
  WORKSPACES_ROOT: z.string().default('/workspaces'),
  REPOS_BASE_DIR: z.string().default('/repos'),
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

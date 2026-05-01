import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fjwt from '@fastify/jwt';
import fcookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env, isProd, isTest } from './env.js';
import { loggerOptions } from './lib/logger.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import minioPlugin from './plugins/minio.js';
import { authRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { projectRoutes } from './routes/projects.js';
import { agentRoutes } from './routes/agents.js';
import websocket from '@fastify/websocket';
import { wsHandler } from './ws/handler.js';
import { githubRoutes } from './routes/github.js';
import { settingsRoutes } from './routes/settings.js';
import { chatRoutes } from './routes/chat.js';
import { metricsRoutes } from './routes/metrics.js';
import { internalRoutes } from './routes/internal.js';
import { companionRoutes } from './routes/companion.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const COOKIE_NAME = 'mesh_token';

export async function buildServer() {
  const fastify = Fastify({
    logger: isTest ? false : loggerOptions,
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: isProd,
    disableRequestLogging: isTest,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const allowed = env.CORS_ALLOWED_ORIGINS;
  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowed.length === 0 && !isProd) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
  });

  await fastify.register(fcookie, {
    parseOptions: { path: '/' },
  });

  await fastify.register(fjwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: COOKIE_NAME, signed: false },
  });

  await fastify.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    allowList: ['127.0.0.1', '::1'],
    keyGenerator: (req) => {
      const auth = (req.headers.authorization ?? '').slice(0, 64);
      return `${req.ip}:${auth}`;
    },
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  await fastify.register(websocket);
  await fastify.register(dbPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(minioPlugin);
  await fastify.register(authRoutes);
  await fastify.register(taskRoutes);
  await fastify.register(projectRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(wsHandler);
  await fastify.register(githubRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(internalRoutes);
  await fastify.register(companionRoutes);

  fastify.get('/health', async () => ({ status: 'ok' }));

  fastify.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.status(400).send({ error: 'ValidationError', details: err.validation });
    }
    req.log.error({ err }, 'Unhandled error');
    const status = err.statusCode ?? 500;
    const message = status >= 500 ? 'Internal Server Error' : err.message;
    reply.status(status).send({ error: message });
  });

  return fastify;
}

export const COOKIE = { name: COOKIE_NAME };

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users } from '@meshagent/shared';
import { env, isProd } from '../env.js';
import {
  ensureSeedUser,
  findUserByEmail,
  hashPassword,
  touchLastLogin,
  verifyPassword,
} from '../lib/users.js';
import { logAudit } from '../lib/audit.js';

const COOKIE_NAME = 'mesh_token';
const TOKEN_TTL = '7d';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional().default(false),
});

const inviteSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export async function authRoutes(fastify: FastifyInstance) {
  await ensureSeedUser(fastify).catch((err) => {
    fastify.log.error({ err }, 'Failed to seed initial user — auth will not work');
  });

  fastify.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: env.AUTH_RATE_LIMIT_MAX,
          timeWindow: env.AUTH_RATE_LIMIT_WINDOW,
        },
      },
    },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const user = await findUserByEmail(fastify, body.email);

      if (!user || !user.isActive) {
        await new Promise((r) => setTimeout(r, 200));
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok) {
        await logAudit(fastify, request, {
          action: 'auth.login.failed',
          target: user.id,
          metadata: { email: body.email },
        });
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = fastify.jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        { expiresIn: TOKEN_TTL },
      );

      const maxAge = body.remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;
      reply.setCookie(COOKIE_NAME, token, cookieOptions(maxAge));
      await touchLastLogin(fastify, user.id);
      await logAudit(fastify, request, { action: 'auth.login.success', target: user.id });

      return {
        token,
        user: { id: user.id, email: user.email, role: user.role },
      };
    },
  );

  fastify.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  fastify.get('/auth/me', { preHandler: [fastify.authenticate] }, async (request) => {
    const u = request.user as { id: string; email: string; role: string };
    return { id: u.id, email: u.email, role: u.role };
  });

  // ---- User management (admin only) ----

  fastify.addHook('onRequest', async () => {});

  const requireAdmin = async (request: any, reply: any) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    const u = request.user as { role: string };
    if (u.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden — admin only' });
    }
  };

  fastify.get('/auth/users', { preHandler: [requireAdmin] }, async () => {
    const all = await fastify.db.select().from(users);
    return all.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }));
  });

  fastify.post('/auth/users', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = inviteSchema.parse(request.body);
    const existing = await findUserByEmail(fastify, body.email);
    if (existing) return reply.status(409).send({ error: 'Email already registered' });

    const passwordHash = await hashPassword(body.password);
    const [created] = await fastify.db
      .insert(users)
      .values({
        email: body.email.toLowerCase().trim(),
        passwordHash,
        role: body.role,
      })
      .returning();
    await logAudit(fastify, request, {
      action: 'auth.user.created',
      target: created.id,
      metadata: { role: created.role },
    });
    return {
      id: created.id,
      email: created.email,
      role: created.role,
      isActive: created.isActive,
    };
  });

  fastify.patch('/auth/users/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateUserSchema.parse(request.body);

    const updates: Record<string, unknown> = {};
    if (body.role) updates.role = body.role;
    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
    if (body.password) updates.passwordHash = await hashPassword(body.password);
    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    const [updated] = await fastify.db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'User not found' });

    await logAudit(fastify, request, {
      action: 'auth.user.updated',
      target: id,
      metadata: { fields: Object.keys(updates) },
    });

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
    };
  });

  fastify.delete('/auth/users/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.user as { id: string };
    if (me.id === id) {
      return reply.status(400).send({ error: 'Cannot delete your own account' });
    }
    const result = await fastify.db.delete(users).where(eq(users.id, id)).returning();
    if (result.length === 0) return reply.status(404).send({ error: 'User not found' });
    await logAudit(fastify, request, { action: 'auth.user.deleted', target: id });
    return reply.status(204).send();
  });
}

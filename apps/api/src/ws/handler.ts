import { FastifyInstance } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import Redis from 'ioredis';
import { env } from '../env.js';

const MAX_CHANNELS_PER_CONN = 16;

async function authenticateSocket(
  fastify: FastifyInstance,
  query: Record<string, unknown>,
  cookieHeader: string | undefined,
): Promise<{ id: string; email: string; role: string } | null> {
  const tokenFromQuery = typeof query.token === 'string' ? query.token : undefined;
  const tokenFromCookie = cookieHeader
    ? /(?:^|;\s*)mesh_token=([^;]+)/.exec(cookieHeader)?.[1]
    : undefined;
  const token = tokenFromQuery ?? tokenFromCookie;
  if (!token) return null;
  try {
    const payload = fastify.jwt.verify<{ id: string; email: string; role: string }>(token);
    return payload;
  } catch {
    return null;
  }
}

export async function wsHandler(fastify: FastifyInstance) {
  fastify.get('/ws', { websocket: true }, async (connection: SocketStream, request) => {
    const user = await authenticateSocket(
      fastify,
      (request.query as Record<string, unknown>) ?? {},
      request.headers.cookie,
    );
    if (!user) {
      connection.socket.close(1008, 'Unauthorized');
      return;
    }

    const { sessionId, channels } =
      (request.query as {
        sessionId?: string;
        channels?: string;
      }) ?? {};

    const subscriptions = new Set<string>();
    if (sessionId) subscriptions.add(`agent:${sessionId}:output`);
    if (channels) {
      for (const c of channels.split(',').slice(0, MAX_CHANNELS_PER_CONN)) {
        const trimmed = c.trim();
        if (trimmed === 'chat') subscriptions.add('chat:events');
        if (trimmed === 'github') subscriptions.add('github:events');
        if (trimmed === 'tasks') subscriptions.add('tasks:events');
      }
    }

    if (subscriptions.size === 0) {
      connection.socket.close(1008, 'No channel selected — set ?sessionId or ?channels');
      return;
    }

    const subscriber = new Redis(env.REDIS_URL);
    const list = Array.from(subscriptions);

    try {
      await subscriber.subscribe(...list);
    } catch (err) {
      request.log.error({ err }, 'Failed to subscribe to Redis channels');
      connection.socket.close(1011, 'Subscription failed');
      subscriber.disconnect();
      return;
    }

    subscriber.on('message', (channel, message) => {
      if (connection.socket.readyState !== connection.socket.OPEN) return;
      try {
        const parsed = JSON.parse(message);
        connection.socket.send(JSON.stringify({ channel, ...parsed }));
      } catch {
        connection.socket.send(JSON.stringify({ channel, raw: message }));
      }
    });

    const ping = setInterval(() => {
      if (connection.socket.readyState === connection.socket.OPEN) {
        connection.socket.ping();
      }
    }, 30000);

    connection.socket.on('close', () => {
      clearInterval(ping);
      subscriber.unsubscribe(...list).catch(() => {});
      subscriber.disconnect();
    });
  });
}

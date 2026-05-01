import { auditLog } from '@meshagent/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface AuditEntry {
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(
  fastify: FastifyInstance,
  request: FastifyRequest | null,
  entry: AuditEntry,
): Promise<void> {
  try {
    const user = request?.user as { id?: string } | undefined;
    await fastify.db.insert(auditLog).values({
      userId: user?.id ?? null,
      action: entry.action,
      target: entry.target ?? null,
      metadata: entry.metadata ?? null,
      ip: request?.ip ?? null,
    });
  } catch (err) {
    fastify.log.warn({ err }, 'Failed to write audit log');
  }
}

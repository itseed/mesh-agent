import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, inArray } from 'drizzle-orm'
import { agentSessions, agentMetrics } from '@meshagent/shared'
import type { AgentSessionStatus } from '@meshagent/shared'

export type SessionRecord = typeof agentSessions.$inferSelect

export interface SessionStore {
  create(rec: typeof agentSessions.$inferInsert): Promise<void>
  update(id: string, patch: Partial<SessionRecord>): Promise<void>
  findById(id: string): Promise<SessionRecord | null>
  findRunning(): Promise<SessionRecord[]>
  recordMetric(rec: typeof agentMetrics.$inferInsert): Promise<void>
  close(): Promise<void>
}

class PgSessionStore implements SessionStore {
  private client: ReturnType<typeof postgres>
  private db: ReturnType<typeof drizzle>

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl, { max: 4, idle_timeout: 30 })
    this.db = drizzle(this.client)
  }

  async create(rec: typeof agentSessions.$inferInsert): Promise<void> {
    await this.db.insert(agentSessions).values(rec)
  }

  async update(id: string, patch: Partial<SessionRecord>): Promise<void> {
    await this.db.update(agentSessions).set(patch).where(eq(agentSessions.id, id))
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const [row] = await this.db.select().from(agentSessions).where(eq(agentSessions.id, id))
    return row ?? null
  }

  async findRunning(): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(agentSessions)
      .where(inArray(agentSessions.status, ['pending', 'running'] as AgentSessionStatus[]))
    return rows
  }

  async recordMetric(rec: typeof agentMetrics.$inferInsert): Promise<void> {
    await this.db.insert(agentMetrics).values(rec)
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 })
  }
}

class NoopSessionStore implements SessionStore {
  async create() {}
  async update() {}
  async findById() {
    return null
  }
  async findRunning() {
    return []
  }
  async recordMetric() {}
  async close() {}
}

export function createSessionStore(databaseUrl: string | undefined): SessionStore {
  if (!databaseUrl) return new NoopSessionStore()
  return new PgSessionStore(databaseUrl)
}

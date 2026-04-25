import Redis from 'ioredis'

export class Streamer {
  private publisher: Redis

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl)
  }

  publishLine(sessionId: string, line: string): void {
    this.publisher.publish(
      `agent:${sessionId}:output`,
      JSON.stringify({ type: 'line', line, timestamp: Date.now() }),
    )
  }

  publishEvent(sessionId: string, event: Record<string, unknown>): void {
    this.publisher.publish(
      `agent:${sessionId}:output`,
      JSON.stringify({ ...event, sessionId, timestamp: Date.now() }),
    )
  }

  async close(): Promise<void> {
    this.publisher.disconnect()
  }
}

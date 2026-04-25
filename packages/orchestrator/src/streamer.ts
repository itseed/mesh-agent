import Redis from 'ioredis'

export class Streamer {
  private publisher: Redis

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl)
  }

  publishLine(sessionId: string, line: string): void {
    this.publisher.publish(
      `agent:${sessionId}:output`,
      JSON.stringify({ line, timestamp: Date.now() }),
    )
  }

  async close(): Promise<void> {
    this.publisher.disconnect()
  }
}

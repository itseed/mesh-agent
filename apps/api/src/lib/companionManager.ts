import type { SocketStream } from '@fastify/websocket';

interface CompanionConnection {
  tokenId: string;
  userId: string;
  ws: SocketStream;
  connectedAt: Date;
}

class CompanionManager {
  private connections = new Map<string, CompanionConnection>();
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  register(tokenId: string, userId: string, ws: SocketStream): void {
    let pongReceived = true;

    ws.socket.on('pong', () => { pongReceived = true; });

    const pingInterval = setInterval(() => {
      if (ws.socket.readyState !== 1) {
        clearInterval(pingInterval);
        this.unregister(tokenId);
        return;
      }
      if (!pongReceived) {
        clearInterval(pingInterval);
        ws.socket.terminate();
        this.unregister(tokenId);
        return;
      }
      pongReceived = false;
      ws.socket.ping();
    }, 30_000);
    ws.socket.on('close', () => clearInterval(pingInterval));
    this.connections.set(tokenId, { tokenId, userId, ws, connectedAt: new Date() });
  }

  unregister(tokenId: string): void {
    this.connections.delete(tokenId);
    for (const [id, pending] of this.pendingRequests) {
      if (id.startsWith(tokenId + ':')) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Companion disconnected'));
        this.pendingRequests.delete(id);
      }
    }
  }

  getConnection(userId: string): CompanionConnection | undefined {
    for (const [tokenId, conn] of this.connections.entries()) {
      if (conn.userId === userId) {
        if (conn.ws.socket.readyState !== 1) {
          this.unregister(tokenId);
          continue;
        }
        return conn;
      }
    }
    return undefined;
  }

  isConnected(userId: string): boolean {
    return !!this.getConnection(userId);
  }

  async call<T>(userId: string, method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    const conn = this.getConnection(userId);
    if (!conn) throw new Error('No companion connected for this user');

    const id = `${conn.tokenId}:${crypto.randomUUID()}`;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Companion RPC timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      try {
        conn.ws.socket.send(msg);
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to send RPC request: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  handleResponse(data: string): void {
    let msg: { id?: string; result?: unknown; error?: { message: string } };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (!msg.id) return;
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.id);

    if (msg.error) pending.reject(new Error(msg.error.message));
    else pending.resolve(msg.result);
  }
}

export const companionManager = new CompanionManager();

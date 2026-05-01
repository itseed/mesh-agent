import WebSocket from 'ws';
import { fsList, fsStat, fsHomedir } from './handlers/fs.js';
import { agentSpawn, agentStdout, agentKill } from './handlers/agent.js';

interface RpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}
interface RpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

const PING_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

const HANDLERS: Record<string, (params: any) => Promise<unknown>> = {
  'fs.list': fsList,
  'fs.stat': fsStat,
  'fs.homedir': fsHomedir,
  'agent.spawn': agentSpawn,
  'agent.stdout': agentStdout,
  'agent.kill': agentKill,
  'companion.ping': async () => ({}),
};

export interface CompanionClientOptions {
  url: string;
  token: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class CompanionClient {
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private opts: CompanionClientOptions) {}

  connect(): void {
    if (this.stopped) return;
    const wsUrl = this.opts.url.replace(/^http/, 'ws') + '/ws/companion';

    this.ws = new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${this.opts.token}` },
    });

    this.ws.on('open', () => {
      console.log('✓ Connected to MeshAgent');
      this.opts.onConnected?.();
      this.pingTimer = setInterval(() => {
        this.ws?.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'companion.ping',
            params: {},
          }),
        );
      }, PING_INTERVAL_MS);
    });

    this.ws.on('message', async (raw: Buffer) => {
      let req: RpcRequest;
      try {
        req = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!req.id || !req.method) return;

      const handler = HANDLERS[req.method];
      if (!handler) {
        this.send({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        });
        return;
      }

      try {
        const result = await handler(req.params ?? {});
        this.send({ jsonrpc: '2.0', id: req.id, result });
      } catch (err: any) {
        this.send({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: err.message ?? 'Internal error' },
        });
      }
    });

    this.ws.on('close', () => {
      this.clearPing();
      this.opts.onDisconnected?.();
      if (!this.stopped) {
        console.log(`Disconnected. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });

    this.ws.on('error', (err) => {
      console.error('Connection error:', err.message);
    });
  }

  stop(): void {
    this.stopped = true;
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private send(msg: RpcResponse): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

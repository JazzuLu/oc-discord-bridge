import { spawn } from 'node:child_process';
import readline from 'node:readline';

export type JsonRpc = {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: any;
  result?: any;
  error?: any;
};

export type AcpUpdate = {
  sessionId: string;
  update: any;
};

export class OpenCodeAcpClient {
  private proc?: ReturnType<typeof spawn>;
  private rl?: readline.Interface;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private updates = new Map<string, ((u: AcpUpdate) => void)[]>();

  constructor(private bin: string, private cwd: string) {}

  start(): void {
    if (this.proc) return;
    this.proc = spawn(this.bin, ['acp', '--cwd', this.cwd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    this.proc.on('exit', (code, signal) => {
      const err = new Error(`opencode acp exited: code=${code} signal=${signal}`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.proc = undefined;
      this.rl?.close();
      this.rl = undefined;
    });

    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line) => {
      line = line.trim();
      if (!line) return;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === 'session/update') {
        const payload = msg.params as AcpUpdate;
        const arr = this.updates.get(payload.sessionId) ?? [];
        for (const cb of arr) cb(payload);
      }
    });
  }

  stop(): void {
    this.proc?.kill('SIGTERM');
  }

  private send(method: string, params?: any): Promise<any> {
    if (!this.proc?.stdin) throw new Error('ACP not started');
    const id = this.nextId++;
    const msg: JsonRpc = { jsonrpc: '2.0', id, method, params };
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async initialize(): Promise<void> {
    await this.send('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: 'oc-discord-bridge', title: 'oc-discord-bridge', version: '0.0.1' },
    });
  }

  onSessionUpdate(sessionId: string, cb: (u: AcpUpdate) => void): () => void {
    const arr = this.updates.get(sessionId) ?? [];
    arr.push(cb);
    this.updates.set(sessionId, arr);
    return () => {
      const cur = this.updates.get(sessionId) ?? [];
      this.updates.set(
        sessionId,
        cur.filter((x) => x !== cb),
      );
    };
  }

  async newSession(cwd: string): Promise<{ sessionId: string }> {
    return await this.send('session/new', { cwd, mcpServers: [] });
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    await this.send('session/load', { sessionId, cwd, mcpServers: [] });
  }

  async prompt(sessionId: string, text: string, onChunk: (t: string) => void): Promise<void> {
    const off = this.onSessionUpdate(sessionId, (u) => {
      const up = u.update;
      if (up?.sessionUpdate === 'agent_message_chunk') {
        const t = up?.content?.text;
        if (typeof t === 'string') onChunk(t);
      }
    });
    try {
      await this.send('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      });
    } finally {
      off();
    }
  }
}

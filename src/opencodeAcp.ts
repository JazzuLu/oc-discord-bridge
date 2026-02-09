import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

type StartOptions = {
  watchdog?: boolean;
};

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
  private loadedSessions = new Set<string>();

  private watchdog = true;
  private stopping = false;
  private restartAttempt = 0;
  private ready: Promise<void> = Promise.resolve();

  constructor(private bin: string, private cwd: string) {}
  async start(opts?: StartOptions): Promise<void> {
    if (typeof opts?.watchdog === 'boolean') this.watchdog = opts.watchdog;
    if (this.proc) return await this.ready;
    this.stopping = false;
    this.proc = spawn(this.bin, ['acp', '--cwd', this.cwd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    // Always (re-)initialize on (re)start.
    this.ready = this.initialize();

    this.proc.on('exit', (code, signal) => {
      const err = new Error(`opencode acp exited: code=${code} signal=${signal}`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.proc = undefined;
      this.rl?.close();
      this.rl = undefined;

      // The ACP server is stateful per-process; session bindings must be re-loaded.
      this.loadedSessions.clear();

      if (!this.stopping && this.watchdog) {
        void this.restartWithBackoff();
      }
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

    // Wait for initialize to finish before returning.
    await this.ready;
  }

  stop(): void {
    this.stopping = true;
    this.proc?.kill('SIGTERM');
  }

  private async restartWithBackoff(): Promise<void> {
    // Exponential backoff (bounded) + small jitter.
    const base = Math.min(30_000, 500 * 2 ** this.restartAttempt);
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;
    this.restartAttempt = Math.min(this.restartAttempt + 1, 10);
    await sleep(delay);
    try {
      await this.start();
      this.restartAttempt = 0;
    } catch {
      // If start/initialize fails, try again.
      if (!this.stopping) void this.restartWithBackoff();
    }
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
    const res = await this.send('session/new', { cwd, mcpServers: [] });
    if (res?.sessionId) this.loadedSessions.add(res.sessionId);
    return res;
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    await this.send('session/load', { sessionId, cwd, mcpServers: [] });
    this.loadedSessions.add(sessionId);
  }

  async ensureSessionLoaded(sessionId: string, cwd: string): Promise<void> {
    // If ACP isn't running, wait for watchdog restart.
    await this.start();
    if (this.loadedSessions.has(sessionId)) return;
    await this.loadSession(sessionId, cwd);
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

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

type DesiredSession = {
  cwd: string;
  meta?: Record<string, unknown>;
};

export class OpenCodeAcpClient {
  private proc?: ReturnType<typeof spawn>;
  private rl?: readline.Interface;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private updates = new Map<string, ((u: AcpUpdate) => void)[]>();

  /** Session IDs that are loaded into the current ACP process instance. */
  private loadedSessions = new Set<string>();

  /** Session IDs that the app expects to exist and be reloadable after ACP restarts. */
  private desiredSessions = new Map<string, DesiredSession>();

  /** Best-effort correlation meta for logs that happen outside a request context (watchdog, exit, etc.). */
  private lastMeta: Record<string, unknown> | undefined;

  private watchdog = true;
  private stopping = false;
  private restartAttempt = 0;
  private restarting = false;
  private restartQueued = false;
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private bin: string,
    private cwd: string,
    private log: (msg: string, meta?: Record<string, unknown>) => void = (msg, meta) => {
      const parts = ['[oc-bridge]', msg];
      if (meta) {
        for (const [k, v] of Object.entries(meta)) parts.push(`${k}=${String(v)}`);
      }
      console.log(parts.join(' '));
    },
  ) {}

  private rememberMeta(meta?: Record<string, unknown>): void {
    if (!meta) return;
    // keep it shallow and small
    this.lastMeta = { ...(this.lastMeta ?? {}), ...meta };
  }

  private m(meta?: Record<string, unknown>): Record<string, unknown> {
    return { ...(this.lastMeta ?? {}), ...(meta ?? {}) };
  }

  private registerDesiredSession(sessionId: string, cwd: string, meta?: Record<string, unknown>): void {
    this.rememberMeta(meta);
    this.desiredSessions.set(sessionId, { cwd, meta });
  }

  /**
   * Track a known session binding so it can be re-loaded after ACP restarts.
   * This does not load the session immediately; call ensureSessionLoaded/loadSession when needed.
   */
  trackSession(sessionId: string, cwd: string, meta?: Record<string, unknown>): void {
    this.registerDesiredSession(sessionId, cwd, meta);
  }

  async start(opts?: StartOptions): Promise<void> {
    if (typeof opts?.watchdog === 'boolean') this.watchdog = opts.watchdog;

    // If we're already started, just await readiness. If readiness failed, force a restart.
    if (this.proc) {
      try {
        await this.ready;
        return;
      } catch (e) {
        this.log('acp:ready_failed', this.m({ err: (e as any)?.message ?? String(e) }));
        this.killProc('ready_failed', this.m({ err: (e as any)?.message ?? String(e) }));
        this.proc = undefined;
        this.rl?.close();
        this.rl = undefined;
        this.loadedSessions.clear();
        // fallthrough to fresh start
      }
    }

    this.stopping = false;
    this.proc = spawn(this.bin, ['acp', '--cwd', this.cwd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    this.log('acp:spawn', this.m({ pid: this.proc.pid }));

    // Always (re-)initialize on (re)start.
    this.ready = this.initialize(this.lastMeta)
      .then(() => this.reloadDesiredSessions())
      .catch((e) => {
        this.log('acp:init_failed', this.m({ err: (e as any)?.message ?? String(e) }));
        // If init fails, ensure this proc doesn't linger in a half-ready state.
        this.killProc('init_failed', this.m({ err: (e as any)?.message ?? String(e) }));

        // If the caller awaited start() and init failed, still allow watchdog to recover.
        if (!this.stopping && this.watchdog) {
          void this.restartWithBackoff();
        }

        throw e;
      });

    this.proc.on('exit', (code, signal) => {
      this.log('acp:exit', this.m({ code, signal }));
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

    // Spawn-level error (e.g. binary missing) won't emit 'exit' consistently.
    this.proc.on('error', (e) => {
      this.log('acp:error', this.m({ err: (e as any)?.message ?? String(e) }));
      const err = new Error(`opencode acp error: ${(e as any)?.message ?? String(e)}`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.proc = undefined;
      this.rl?.close();
      this.rl = undefined;
      this.loadedSessions.clear();
      if (!this.stopping && this.watchdog) {
        void this.restartWithBackoff();
      }
    });

    // Surface stderr for debugging (no secrets expected here; still keep it terse).
    this.proc.stderr?.on('data', (buf) => {
      const s = String(buf).trim();
      if (!s) return;
      const line = s.split(/\r?\n/)[0];
      this.log('acp:stderr', this.m({ line: line.slice(0, 500) }));
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
    this.killProc('stop', this.lastMeta);
  }

  private killProc(reason: string, meta?: Record<string, unknown>): void {
    const p = this.proc;
    if (!p) return;

    this.log('acp:kill', this.m({ reason, pid: p.pid, ...(meta ?? {}) }));

    try {
      p.kill('SIGTERM');
    } catch {}

    // If it doesn't exit promptly, force kill. Avoid leaving a wedged ACP.
    setTimeout(() => {
      // If process already cleared, ignore.
      if (this.proc !== p) return;
      try {
        this.log('acp:kill_sigkill', this.m({ reason, pid: p.pid }));
        p.kill('SIGKILL');
      } catch {}
    }, 3_000).unref?.();
  }

  private async reloadDesiredSessions(): Promise<void> {
    const entries = [...this.desiredSessions.entries()];
    if (entries.length === 0) return;

    // Reload is best-effort. If it fails for some sessions, callers can still ensureSessionLoaded.
    this.log('acp:reload_sessions_start', this.m({ count: entries.length }));

    for (const [sessionId, info] of entries) {
      try {
        await this.send('session/load', { sessionId, cwd: info.cwd, mcpServers: [] }, undefined, this.m(info.meta));
        this.loadedSessions.add(sessionId);
        this.log('acp:reload_session_ok', this.m({ sessionId, ...(info.meta ?? {}) }));
      } catch (e: any) {
        this.log(
          'acp:reload_session_failed',
          this.m({ sessionId, err: e?.message ?? String(e), ...(info.meta ?? {}) }),
        );
      }
    }
  }

  private async restartWithBackoff(): Promise<void> {
    if (this.restarting) {
      this.restartQueued = true;
      return;
    }

    this.restarting = true;
    try {
      // Exponential backoff (bounded) + small jitter.
      const base = Math.min(30_000, 500 * 2 ** this.restartAttempt);
      const jitter = Math.floor(Math.random() * 250);
      const delay = base + jitter;
      const attempt = this.restartAttempt + 1;
      this.restartAttempt = Math.min(this.restartAttempt + 1, 10);

      this.log('acp:watchdog_restart_scheduled', this.m({ attempt, delayMs: delay }));
      await sleep(delay);

      try {
        await this.start({ watchdog: true });
        this.log('acp:watchdog_restart_ok', this.m({ attempt }));
        this.restartAttempt = 0;
      } catch (e) {
        this.log('acp:watchdog_restart_failed', this.m({ attempt, err: (e as any)?.message ?? String(e) }));
        // Queue another attempt.
        if (!this.stopping) this.restartQueued = true;
      }
    } finally {
      this.restarting = false;
      if (this.restartQueued && !this.stopping && this.watchdog) {
        this.restartQueued = false;
        void this.restartWithBackoff();
      }
    }
  }

  private send(
    method: string,
    params?: any,
    opts?: { timeoutMs?: number },
    meta?: Record<string, unknown>,
  ): Promise<any> {
    this.rememberMeta(meta);
    if (!this.proc?.stdin) throw new Error('ACP not started');
    const id = this.nextId++;
    const msg: JsonRpc = { jsonrpc: '2.0', id, method, params };

    try {
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    } catch (e: any) {
      // If stdin is broken (EPIPE), force a restart. Callers can retry.
      this.log('acp:stdin_write_failed', this.m({ method, id, err: e?.message ?? String(e), ...(meta ?? {}) }));
      if (!this.stopping && this.watchdog) {
        this.killProc('stdin_write_failed', this.m({ method, id, ...(meta ?? {}) }));
      }
      throw e;
    }

    const timeoutMs = opts?.timeoutMs ?? 20_000;

    return new Promise((resolve, reject) => {
      let t: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs > 0) {
        t = setTimeout(() => {
          this.pending.delete(id);
          const err = new Error(`ACP request timeout: method=${method} id=${id} timeoutMs=${timeoutMs}`);
          reject(err);

          // If ACP stops responding, force a restart (watchdog will bring it back).
          if (!this.stopping && this.watchdog) {
            this.log('acp:request_timeout_restart', this.m({ method, id, timeoutMs, ...(meta ?? {}) }));
            this.killProc('request_timeout', this.m({ method, id, timeoutMs, ...(meta ?? {}) }));
          }
        }, timeoutMs);
      }

      this.pending.set(id, {
        resolve: (v) => {
          if (t) clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          if (t) clearTimeout(t);
          reject(e);
        },
      });
    });
  }

  async initialize(meta?: Record<string, unknown>): Promise<void> {
    await this.send(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: 'oc-discord-bridge', title: 'oc-discord-bridge', version: '0.0.1' },
      },
      undefined,
      meta,
    );
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

  async newSession(cwd: string, meta?: Record<string, unknown>): Promise<{ sessionId: string }> {
    this.rememberMeta(meta);
    const res = await this.send('session/new', { cwd, mcpServers: [] }, undefined, meta);
    if (res?.sessionId) {
      this.registerDesiredSession(res.sessionId, cwd, meta);
      this.loadedSessions.add(res.sessionId);
      this.log('acp:session_new', this.m({ sessionId: res.sessionId, ...(meta ?? {}) }));
    }
    return res;
  }

  async loadSession(sessionId: string, cwd: string, meta?: Record<string, unknown>): Promise<void> {
    this.registerDesiredSession(sessionId, cwd, meta);
    this.log('acp:session_load', this.m({ sessionId, ...(meta ?? {}) }));
    await this.send('session/load', { sessionId, cwd, mcpServers: [] }, undefined, this.m({ sessionId, ...(meta ?? {}) }));
    this.loadedSessions.add(sessionId);
  }

  async ensureSessionLoaded(sessionId: string, cwd: string, meta?: Record<string, unknown>): Promise<void> {
    this.registerDesiredSession(sessionId, cwd, meta);

    // If ACP isn't running, wait for watchdog restart.
    await this.start({ watchdog: true });
    if (this.loadedSessions.has(sessionId)) return;
    await this.loadSession(sessionId, cwd, meta);
  }

  async prompt(
    sessionId: string,
    text: string,
    onChunk: (t: string) => void,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    this.rememberMeta(meta);

    const off = this.onSessionUpdate(sessionId, (u) => {
      const up = u.update;
      if (up?.sessionUpdate === 'agent_message_chunk') {
        const t = up?.content?.text;
        if (typeof t === 'string') onChunk(t);
      }
    });

    try {
      // Bounded retry: ACP can be mid-restart or briefly unavailable.
      // Higher-level callers also retry; this is a last-mile hedge.
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.send(
            'session/prompt',
            {
              sessionId,
              prompt: [{ type: 'text', text }],
            },
            { timeoutMs: 60_000 },
            this.m({ sessionId, attempt, ...(meta ?? {}) }),
          );
          return;
        } catch (e) {
          lastErr = e;
          if (attempt >= 3) break;

          const base = 200 * 2 ** (attempt - 1);
          const jitter = Math.floor(Math.random() * 150);
          const delay = Math.min(2_000, base + jitter);

          this.log(
            'acp:prompt_retry',
            this.m({ sessionId, attempt, delayMs: delay, err: (e as any)?.message ?? String(e), ...(meta ?? {}) }),
          );

          // Backoff + give watchdog a chance to restart.
          await sleep(delay);
          await this.start({ watchdog: true });
        }
      }
      throw lastErr;
    } finally {
      off();
    }
  }
}

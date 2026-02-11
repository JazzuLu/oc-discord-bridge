import fs from 'node:fs/promises';
import path from 'node:path';

export type ChannelCwdMap = Record<string, { cwd: string; updatedAt: number }>;
export type ChannelMainThreadMap = Record<string, { threadId: string; updatedAt: number }>;
export type ThreadSessionMap =
  | Record<
      string,
      {
        sessionId: string;
        cwd: string;
        createdAt: number;
        updatedAt: number;
      }
    >;
export type PausedChannelsMap = Record<string, true>;

export class JsonStore {
  constructor(private dir: string) {}

  /**
   * Per-file async queue to prevent lost updates from concurrent read-modify-write cycles.
   *
   * NOTE: this is in-process only (not cross-process). It's still a big win for Discord
   * message concurrency within a single running bridge instance.
   */
  private queues = new Map<string, Promise<unknown>>();

  private file(name: string) {
    return path.join(this.dir, name);
  }

  private enqueue<T>(name: string, task: () => Promise<T>): Promise<T> {
    const prev = (this.queues.get(name) ?? Promise.resolve()) as Promise<unknown>;
    const next = prev.then(task, task);

    // Keep the queue alive even if task rejects, but release it when this task finishes.
    this.queues.set(
      name,
      next.finally(() => {
        if (this.queues.get(name) === next) this.queues.delete(name);
      }),
    );

    return next;
  }

  async ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async readJson<T>(name: string, fallback: T): Promise<T> {
    await this.ensureDir();
    const filePath = this.file(name);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return fallback;

      const isSyntax = e instanceof SyntaxError || e?.name === 'SyntaxError';
      if (isSyntax) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = this.file(`${name}.corrupt.${stamp}`);

        // Best-effort: keep the corrupt file for later inspection.
        await fs.rename(filePath, backupPath).catch(() => null);

        // Reset the store so we don't repeatedly crash on startup.
        await this.writeJson(name, fallback).catch(() => null);

        console.warn(
          `[oc-bridge] JsonStore: corrupted JSON (${name}); backed up to ${backupPath}; reset to fallback`,
        );
        return fallback;
      }

      throw e;
    }
  }

  async writeJson<T>(name: string, value: T): Promise<void> {
    await this.ensureDir();
    const tmp = this.file(name + '.tmp');
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, this.file(name));
  }

  /**
   * Atomic-ish read-modify-write helper (serialized per JSON file).
   */
  async updateJson<T>(name: string, fallback: T, fn: (cur: T) => T | Promise<T>): Promise<T> {
    return this.enqueue(name, async () => {
      const cur = await this.readJson<T>(name, fallback);
      const next = await fn(cur);
      await this.writeJson(name, next);
      return next;
    });
  }
}


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

  private file(name: string) {
    return path.join(this.dir, name);
  }

  async ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async readJson<T>(name: string, fallback: T): Promise<T> {
    await this.ensureDir();
    try {
      const raw = await fs.readFile(this.file(name), 'utf8');
      return JSON.parse(raw) as T;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return fallback;
      throw e;
    }
  }

  async writeJson<T>(name: string, value: T): Promise<void> {
    await this.ensureDir();
    const tmp = this.file(name + '.tmp');
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, this.file(name));
  }
}

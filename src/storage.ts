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

    const filePath = this.file(name);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      try {
        return JSON.parse(raw) as T;
      } catch (parseErr: any) {
        // Corrupted JSON (e.g. partial write / manual edits).
        // Back it up and reset to fallback so the service can keep running.
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${filePath}.corrupt-${ts}.bak`;

        console.error(
          `[oc-bridge] storage: corrupted JSON in ${filePath}; backing up to ${backupPath} and resetting to fallback`,
        );

        try {
          await fs.rename(filePath, backupPath);
        } catch (renameErr: any) {
          console.error(
            `[oc-bridge] storage: failed to backup corrupted file ${filePath}: ${renameErr?.message ?? renameErr}`,
          );
        }

        try {
          await this.writeJson(name, fallback);
        } catch (writeErr: any) {
          console.error(
            `[oc-bridge] storage: failed to reset ${filePath} to fallback: ${writeErr?.message ?? writeErr}`,
          );
        }

        return fallback;
      }
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

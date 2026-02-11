import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from './config.js';

export type CwdValidationResult =
  | { ok: true; cwd: string }
  | { ok: false; reason: 'empty' | 'not_absolute' | 'not_found' | 'not_directory' | 'not_allowed'; details?: string };

function normAbs(p: string): string {
  // Resolve + normalize for prefix checks; preserve realpath? (avoid IO here)
  return path.resolve(p);
}

export async function validateChannelCwd(cfg: Pick<Config, 'DISCORD_ALLOWED_CWD_PREFIXES'>, cwd: string | null | undefined) {
  const raw = (cwd ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' } as const;

  if (!path.isAbsolute(raw)) return { ok: false, reason: 'not_absolute' } as const;

  let st: any;
  try {
    st = await fs.stat(raw);
  } catch (e: any) {
    return { ok: false, reason: 'not_found' } as const;
  }

  if (!st?.isDirectory?.()) return { ok: false, reason: 'not_directory' } as const;

  const prefixes = (cfg.DISCORD_ALLOWED_CWD_PREFIXES ?? []).map((p) => p.trim()).filter(Boolean);
  if (prefixes.length === 0) return { ok: true, cwd: raw } as const;

  const normalized = normAbs(raw);
  for (const pref of prefixes) {
    if (!path.isAbsolute(pref)) continue; // ignore misconfig
    const nPref = normAbs(pref);
    if (normalized === nPref) return { ok: true, cwd: raw } as const;

    // Ensure prefix match is path-segment safe.
    const rel = path.relative(nPref, normalized);
    if (rel === '') return { ok: true, cwd: raw } as const;
    if (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) {
      return { ok: true, cwd: raw } as const;
    }
  }

  return { ok: false, reason: 'not_allowed', details: `allowed prefixes: ${prefixes.join(', ')}` } as const;
}

export function formatCwdValidationError(r: Exclude<CwdValidationResult, { ok: true }>): string {
  switch (r.reason) {
    case 'empty':
      return 'CWD is empty';
    case 'not_absolute':
      return 'CWD must be an absolute path';
    case 'not_found':
      return 'CWD path does not exist';
    case 'not_directory':
      return 'CWD path is not a directory';
    case 'not_allowed':
      return 'CWD path is outside allowed prefixes';
    default:
      return 'Invalid CWD';
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from './config.js';

export type CwdValidationResult =
  | { ok: true; cwd: string }
  | {
      ok: false;
      reason: 'empty' | 'invalid_chars' | 'not_absolute' | 'not_found' | 'not_directory' | 'not_allowed';
      details?: string;
    }; 

function normAbs(p: string): string {
  return path.resolve(p);
}

async function tryRealpath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

export async function validateChannelCwd(
  cfg: Pick<Config, 'DISCORD_CWD_ALLOW_ROOTS' | 'DISCORD_CWD_REQUIRE_EXISTS' | 'DISCORD_ALLOWED_CWD_PREFIXES'>,
  cwd: string | null | undefined,
) {
  const raw = (cwd ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' } as const;

  // Basic injection / parsing hardening.
  if (/\0|\r|\n/.test(raw)) return { ok: false, reason: 'invalid_chars' } as const;

  if (!path.isAbsolute(raw)) return { ok: false, reason: 'not_absolute' } as const;

  const requireExists = cfg.DISCORD_CWD_REQUIRE_EXISTS ?? true;

  let st: any = null;
  if (requireExists) {
    try {
      st = await fs.stat(raw);
    } catch {
      return { ok: false, reason: 'not_found' } as const;
    }

    if (!st?.isDirectory?.()) return { ok: false, reason: 'not_directory' } as const;
  }

  const rootsRaw = (cfg.DISCORD_CWD_ALLOW_ROOTS ?? cfg.DISCORD_ALLOWED_CWD_PREFIXES ?? [])
    .map((p) => p.trim())
    .filter(Boolean);
  if (rootsRaw.length === 0) return { ok: true, cwd: raw } as const;

  // If roots are configured, we must be able to resolve the path to compare safely.
  // (Otherwise, symlinks could escape the allowed roots.)
  let resolved = raw;
  if (requireExists) {
    resolved = await tryRealpath(raw);
  } else {
    // With requireExists=false we can't reliably realpath(). Reject to keep the rule meaningful.
    return { ok: false, reason: 'not_found', details: 'CWD must exist when DISCORD_CWD_ALLOW_ROOTS is set' } as const;
  }

  const normalized = normAbs(resolved);
  for (const root of rootsRaw) {
    if (!path.isAbsolute(root)) continue; // ignore misconfig
    const resolvedRoot = normAbs(await tryRealpath(root));

    if (normalized === resolvedRoot) return { ok: true, cwd: raw } as const;

    const rel = path.relative(resolvedRoot, normalized);
    if (rel === '') return { ok: true, cwd: raw } as const;
    if (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) {
      return { ok: true, cwd: raw } as const;
    }
  }

  return { ok: false, reason: 'not_allowed', details: `allowed roots: ${rootsRaw.join(', ')}` } as const;
}

export function formatCwdValidationError(r: Exclude<CwdValidationResult, { ok: true }>): string {
  switch (r.reason) {
    case 'empty':
      return 'CWD is empty';
    case 'invalid_chars':
      return 'CWD contains invalid characters';
    case 'not_absolute':
      return 'CWD must be an absolute path';
    case 'not_found':
      return 'CWD path does not exist';
    case 'not_directory':
      return 'CWD path is not a directory';
    case 'not_allowed':
      return 'CWD path is outside allowed roots';
    default:
      return 'Invalid CWD';
  }
}

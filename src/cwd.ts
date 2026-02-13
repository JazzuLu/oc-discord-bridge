import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from './config.js';

export type CwdValidationResult =
  | { ok: true; cwd: string }
  | {
      ok: false;
      reason:
        | 'empty'
        | 'contains_nul'
        | 'not_absolute'
        | 'not_normalized'
        | 'not_found'
        | 'not_directory'
        | 'not_allowed';
      details?: string;
    };

function stripTrailingSep(p: string): string {
  // Keep root (e.g. '/' or 'C:\\') intact, but otherwise strip trailing separators.
  const rootLen = path.parse(p).root.length;
  let out = p;
  while (out.length > rootLen && out.endsWith(path.sep)) out = out.slice(0, -1);
  return out;
}

function normAbs(p: string): string {
  // Resolve + normalize for prefix checks.
  return stripTrailingSep(path.resolve(p));
}

function isNormalizedPathInput(rawAbs: string): boolean {
  // Enforce that the user-provided absolute path is already normalized (no '..', '.', duplicate seps, etc.).
  // This avoids ambiguous inputs and makes logging/auditing clearer.
  const raw = stripTrailingSep(rawAbs);
  const normalized = stripTrailingSep(path.normalize(rawAbs));
  return raw === normalized;
}

export async function validateChannelCwd(cfg: Pick<Config, 'DISCORD_ALLOWED_CWD_PREFIXES'>, cwd: string | null | undefined) {
  const raw = (cwd ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' } as const;

  // Guard against NUL-byte injection / truncation issues in downstream tooling.
  if (raw.includes('\0')) return { ok: false, reason: 'contains_nul' } as const;

  if (!path.isAbsolute(raw)) return { ok: false, reason: 'not_absolute' } as const;

  // Require normalized absolute path input (no '..' / '.' / duplicate separators, etc.).
  // This is intentionally strict: users can copy/paste the canonical path.
  if (!isNormalizedPathInput(raw)) {
    return { ok: false, reason: 'not_normalized', details: `expected: ${path.normalize(raw)}` } as const;
  }

  let st: any;
  try {
    st = await fs.stat(raw);
  } catch (e: any) {
    return { ok: false, reason: 'not_found' } as const;
  }

  if (!st?.isDirectory?.()) return { ok: false, reason: 'not_directory' } as const;

  // Resolve symlinks before allowlist checks, so a symlink inside an allowed
  // prefix cannot point outside.
  let realCwd = raw;
  try {
    realCwd = await fs.realpath(raw);
  } catch {
    // Best-effort; we already stat()'d it.
  }

  const prefixes = (cfg.DISCORD_ALLOWED_CWD_PREFIXES ?? []).map((p) => p.trim()).filter(Boolean);
  if (prefixes.length === 0) return { ok: true, cwd: raw } as const;

  const normalized = normAbs(realCwd);
  for (const pref of prefixes) {
    if (!path.isAbsolute(pref)) continue; // ignore misconfig

    // Best-effort resolve/realpath prefix too.
    let realPref = pref;
    try {
      realPref = await fs.realpath(pref);
    } catch {
      // Keep pref as-is; misconfigured prefixes shouldn't grant access.
    }

    const nPref = normAbs(realPref);
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
    case 'contains_nul':
      return 'CWD contains a NUL byte';
    case 'not_absolute':
      return 'CWD must be an absolute path';
    case 'not_normalized':
      return 'CWD must be a normalized absolute path (no ../ or ./)';
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

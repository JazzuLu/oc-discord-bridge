import os from 'node:os';

type Rule = { name: string; re: RegExp; replace: string | ((...args: any[]) => string) };

// Keep this intentionally conservative to reduce false-positives.
const RULES: Rule[] = [
  // OpenAI-style keys
  { name: 'openai', re: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: 'sk-***REDACTED***' },

  // GitHub tokens
  { name: 'ghp', re: /\bghp_[A-Za-z0-9]{20,}\b/g, replace: 'ghp_***REDACTED***' },
  { name: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: 'github_pat_***REDACTED***' },

  // Slack tokens
  { name: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: 'xox*-***REDACTED***' },

  // Discord bot/user tokens (very common leak pattern)
  {
    name: 'discord',
    re: /\b[\w-]{24}\.[\w-]{6}\.[\w-]{27}\b/g,
    replace: '***DISCORD_TOKEN_REDACTED***',
  },

  // AWS access key id (do NOT attempt to detect secret access keys; too many false positives)
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g, replace: 'AKIA***REDACTED***' },

  // Generic bearer tokens (common leak pattern)
  {
    name: 'bearer',
    re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g,
    replace: 'Bearer ***REDACTED***',
  },
  {
    name: 'token_kv',
    re: /\b(access_token|refresh_token|token)=([A-Za-z0-9._-]{20,})\b/g,
    replace: (_m: string, k: string) => `${k}=***REDACTED***`,
  },

  // PEM private keys (multi-line)
  {
    name: 'pem',
    re: /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]+ PRIVATE KEY-----/g,
    replace: '-----BEGIN PRIVATE KEY-----\n***REDACTED***\n-----END PRIVATE KEY-----',
  },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const r of RULES) {
    out = out.replace(r.re, r.replace as any);
  }
  return out;
}

function redactHomeDir(input: string): string {
  const home = os.homedir();
  if (!home) return input;
  // Normalize both plain and URL-encoded-ish variants conservatively.
  return input.split(home).join('~');
}

function redactLongAbsPaths(input: string): string {
  // Only touch very long absolute paths to reduce false positives.
  // Example: /var/folders/.../T/tmpfile -> /…/tmpfile
  return input.replace(/\/[\w\-.~/]{60,}/g, (m) => {
    const s = m.replace(/\s+/g, '');
    const parts = s.split('/').filter(Boolean);
    const base = parts.at(-1);
    if (!base) return '/…';
    return `/…/${base}`;
  });
}

/**
 * A slightly broader redaction intended for logs. This is still best-effort.
 * - Masks known secret/token patterns
 * - Replaces home dir with ~
 * - Shortens very long absolute paths
 */
export function redactForLogs(input: string): string {
  return redactLongAbsPaths(redactHomeDir(redactSecrets(input)));
}

type Rule = { name: string; re: RegExp; replace: string | ((m: string) => string) };

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

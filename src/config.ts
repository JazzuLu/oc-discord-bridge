import { z } from 'zod';

function envBool(defaultValue: boolean) {
  return z
    .preprocess((v) => {
      if (v == null) return defaultValue;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === '') return defaultValue;
        return ['1', 'true', 'yes', 'on'].includes(s);
      }
      return defaultValue;
    }, z.boolean())
    .default(defaultValue);
}

export const ConfigSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  // Optional: comma-separated list of allowed user IDs.
  DISCORD_ALLOW_USER_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Optional: comma-separated list of allowed parent channel IDs.
  // When set, the bridge will ignore messages/interactions outside these channels.
  // (Threads are allowed iff their parent channel is allowed.)
  DISCORD_ALLOW_CHANNEL_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Optional: comma-separated list of role IDs allowed.
  // Applies to:
  // - /oc slash commands
  // - message forwarding (MessageCreate)
  DISCORD_ALLOW_ROLE_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Security hardening (opt-in): when true, and both allowlists are empty,
  // deny /oc + forwarding instead of default-open.
  // Default false for backwards compatibility.
  DISCORD_DEFAULT_DENY: envBool(false),

  DISCORD_IGNORE_BOTS: envBool(true),
  DISCORD_IGNORE_CHANNELS_WITHOUT_CWD: envBool(true),

  // Optional: comma-separated list of allowed absolute path prefixes for channel CWD.
  // When empty/unset, any absolute existing directory is accepted (backwards compatible).
  DISCORD_ALLOWED_CWD_PREFIXES: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Optional: redact common secret patterns in logs + messages echoed back to Discord.
  // Default false to avoid surprising output changes.
  REDACT_SECRETS: envBool(false),

  OPENCODE_BIN: z.string().default('opencode'),
  OPENCODE_ACP_AUTOSTART: envBool(true),
  OPENCODE_DEFAULT_CWD: z.string().optional(),

  DATA_DIR: z.string().default('.data'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config:\n${msg}`);
  }
  return parsed.data;
}

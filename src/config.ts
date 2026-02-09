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
  DISCORD_ALLOW_USER_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DISCORD_IGNORE_BOTS: envBool(true),
  DISCORD_IGNORE_CHANNELS_WITHOUT_CWD: envBool(true),

  OPENCODE_BIN: z.string().default('opencode'),
  OPENCODE_ACP_AUTOSTART: envBool(true),
  OPENCODE_ACP_HOSTNAME: z.string().default('127.0.0.1'),
  OPENCODE_ACP_PORT: z
    .preprocess((v) => {
      if (v == null) return 0;
      const s = String(v).trim();
      if (s === '') return 0;
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    }, z.number().int().min(0).max(65535))
    .default(0),
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

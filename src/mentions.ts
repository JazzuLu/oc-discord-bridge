import type { AllowedMentionsTypes } from 'discord.js';
import type { Config } from './config.js';

// Defense-in-depth for issue #175: never allow mass mentions by default.
//
// Discord will render @everyone/@here and role/user mentions unless allowedMentions restricts them.
// By default we disable parsing entirely (parse: []).
//
// You can opt back in with DISCORD_ALLOW_MENTIONS=true.
export const DEFAULT_ALLOWED_MENTIONS = {
  parse: [] as AllowedMentionsTypes[],
  users: [] as string[],
  roles: [] as string[],
  repliedUser: false,
} as const;

export function withAllowedMentions<T extends Record<string, any>>(
  cfg: Pick<Config, 'DISCORD_ALLOW_MENTIONS'>,
  opts: T,
): T {
  if (cfg.DISCORD_ALLOW_MENTIONS) return opts;
  if (opts && typeof opts === 'object' && 'allowedMentions' in opts && opts.allowedMentions != null) return opts;
  return { ...(opts as any), allowedMentions: DEFAULT_ALLOWED_MENTIONS };
}

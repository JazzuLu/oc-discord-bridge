import type { MessageMentionOptions } from 'discord.js';

/**
 * Disable all Discord mentions in bot output.
 *
 * This prevents accidental pings from model output like:
 * - @everyone / @here
 * - <@userId>
 * - <@&roleId>
 */
export const DISCORD_NO_MENTIONS: { allowedMentions: MessageMentionOptions } = {
  allowedMentions: {
    parse: [],
    users: [],
    roles: [],
    repliedUser: false,
  },
};

export function withNoMentions<T extends Record<string, any>>(opts: T): T & typeof DISCORD_NO_MENTIONS {
  return { ...opts, ...DISCORD_NO_MENTIONS };
}

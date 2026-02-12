import type { MessageMentionOptions } from 'discord.js';

/**
 * Security hardening: bridged content must never produce pings.
 *
 * Discord defaults to parsing mentions in message content. For bridge output, we
 * always disable mention parsing so untrusted text cannot ping @everyone/@here,
 * roles, or users.
 */
export const BRIDGE_ALLOWED_MENTIONS: MessageMentionOptions = {
  parse: [],
};

export function bridgeMessageOptions<T extends Record<string, any>>(
  opts: T,
): Omit<T, 'allowedMentions'> & { allowedMentions: MessageMentionOptions } {
  return {
    ...(opts as any),
    allowedMentions: BRIDGE_ALLOWED_MENTIONS,
  };
}

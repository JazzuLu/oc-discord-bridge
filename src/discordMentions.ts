import type {
  AllowedMentionsTypes,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from 'discord.js';

// Security hardening: never allow bot output to create pings.
// See issue #274.
export const ALLOWED_MENTIONS_NONE: {
  parse: AllowedMentionsTypes[];
  users: string[];
  roles: string[];
} = {
  parse: [],
  users: [],
  roles: [],
};

export function withNoMentions<T extends Record<string, any>>(opts: T): T {
  return { ...opts, allowedMentions: ALLOWED_MENTIONS_NONE };
}

export function contentNoMentions(content: string, extra?: Record<string, any>): Record<string, any> {
  return withNoMentions({ ...(extra ?? {}), content });
}

export async function safeReply(
  msg: { reply: (opts: any) => Promise<any> },
  content: string,
  extra?: Record<string, any>,
): Promise<any> {
  return msg.reply(contentNoMentions(content, extra));
}

export async function safeEdit(
  message: { edit: (opts: any) => Promise<any> },
  content: string,
  extra?: Record<string, any>,
): Promise<any> {
  return message.edit(contentNoMentions(content, extra));
}

export function ixReplyNoMentions(opts: InteractionReplyOptions): InteractionReplyOptions {
  return withNoMentions(opts) as InteractionReplyOptions;
}

export function ixEditReplyNoMentions(opts: InteractionEditReplyOptions): InteractionEditReplyOptions {
  return withNoMentions(opts) as InteractionEditReplyOptions;
}

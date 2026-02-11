export type DiscordForwardTriggerMode = 'off' | 'mention' | 'prefix' | 'mention_or_prefix';

export type ExplicitTriggerMatchResult =
  | { matched: false }
  | {
      matched: true;
      // Message content with the trigger stripped (best-effort) so the forwarded prompt is clean.
      content: string;
    };

function stripLeadingMention(content: string, botUserId: string): string {
  // Discord mentions can be <@id> or <@!id>
  const re = new RegExp(`^<@!?${botUserId}>\\s*`);
  return content.replace(re, '');
}

export function matchExplicitTrigger(opts: {
  mode: DiscordForwardTriggerMode;
  prefix: string;
  content: string;
  botUserId?: string | null;
  isBotMentioned: boolean;
}): ExplicitTriggerMatchResult {
  const mode = opts.mode;
  if (mode === 'off') return { matched: true, content: opts.content };

  const content = opts.content ?? '';
  const prefix = opts.prefix ?? '';

  const canMentionMatch = Boolean(opts.botUserId) && opts.isBotMentioned;
  const canPrefixMatch = Boolean(prefix) && content.startsWith(prefix);

  const mentionOk = mode === 'mention' || mode === 'mention_or_prefix';
  const prefixOk = mode === 'prefix' || mode === 'mention_or_prefix';

  const mentionMatched = mentionOk && canMentionMatch;
  const prefixMatched = prefixOk && canPrefixMatch;

  if (!mentionMatched && !prefixMatched) return { matched: false };

  let stripped = content;
  if (prefixMatched) {
    stripped = stripped.slice(prefix.length);
  } else if (mentionMatched && opts.botUserId) {
    // Only strip if the mention is leading; if user mentioned in the middle, keep the content.
    stripped = stripLeadingMention(stripped, opts.botUserId);
  }

  return { matched: true, content: stripped.trimStart() };
}

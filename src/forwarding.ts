export type ForwardMode = 'auto' | 'mention' | 'prefix';

export type ForwardDecision =
  | { ok: true; content: string }
  | { ok: false; reason: 'not_mentioned' | 'missing_prefix' };

export function decideForwardContent(args: {
  mode: ForwardMode;
  prefix: string;
  content: string;
  mentionsBot: boolean;
}): ForwardDecision {
  const mode = args.mode;
  const prefix = args.prefix;
  const content = args.content ?? '';

  if (mode === 'auto') {
    return { ok: true, content };
  }

  if (mode === 'mention') {
    if (!args.mentionsBot) return { ok: false, reason: 'not_mentioned' };
    return { ok: true, content };
  }

  // prefix
  const trimmedStart = content.replace(/^\s+/, '');
  if (!trimmedStart.startsWith(prefix)) {
    return { ok: false, reason: 'missing_prefix' };
  }
  let rest = trimmedStart.slice(prefix.length);
  // Common ergonomics: allow a single space after prefix.
  if (rest.startsWith(' ')) rest = rest.slice(1);
  return { ok: true, content: rest };
}

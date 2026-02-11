import type { Message } from 'discord.js';

export type StreamToDiscordOptions = {
  withDiscordRetry: <T>(fn: () => Promise<T>, meta: { phase: string }) => Promise<T>;
  redact?: boolean;
  redactSecrets?: (s: string) => string;
  maxLen?: number;
  // Tunables mainly for tests.
  scheduleDelayMs?: number;
  editThrottleMs?: number;
  nowFn?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimeoutFn?: (t: NodeJS.Timeout) => void;
};

export async function streamToDiscord(
  msg: Message,
  onChunk: (cb: (t: string) => void) => Promise<void>,
  opts: StreamToDiscordOptions,
): Promise<void> {
  const {
    withDiscordRetry,
    redact = false,
    redactSecrets,
    maxLen = 2000,
    scheduleDelayMs = 1200,
    editThrottleMs = 1100,
    nowFn = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = opts;

  const placeholder = await withDiscordRetry(() => msg.reply('…'), { phase: 'reply_placeholder' });
  let text = '';
  let lastEdit = 0;

  // Track how much of the tail (beyond maxLen) has already been emitted as continuation replies.
  // This prevents duplicate/spam when flush() runs multiple times while text keeps growing.
  let sentTail = 0;

  // Serialize Discord writes for this stream to avoid overlapping edits/replies under burst.
  let q: Promise<void> = Promise.resolve();
  const serial = (fn: () => Promise<void>) => {
    q = q.then(fn, fn);
    return q;
  };

  let scheduled: NodeJS.Timeout | null = null;
  const scheduleFlush = (force = false) => {
    if (force) return void flush(true);
    if (scheduled) return;
    scheduled = setTimeoutFn(() => {
      scheduled = null;
      void flush(false);
    }, scheduleDelayMs);
  };

  const flush = async (force = false) => {
    const now = nowFn();
    if (!force && now - lastEdit < editThrottleMs) return;
    lastEdit = now;

    const safeText = redact && redactSecrets ? redactSecrets(text) : text;

    await serial(async () => {
      if (safeText.length <= maxLen) {
        sentTail = 0;
        await withDiscordRetry(() => placeholder.edit(safeText || ''), { phase: 'edit_placeholder' });
        return;
      }

      // If too long, keep the placeholder capped at maxLen and emit only *new* tail as replies.
      const head = safeText.slice(0, maxLen);
      await withDiscordRetry(() => placeholder.edit(head), { phase: 'edit_placeholder_head' });

      const tail = safeText.slice(maxLen);
      if (tail.length < sentTail) {
        // Redaction can (rarely) change earlier text length; clamp to avoid negative slicing.
        sentTail = tail.length;
      }

      let rest = tail.slice(sentTail);
      while (rest.length > 0) {
        const part = rest.slice(0, maxLen);
        // eslint-disable-next-line no-await-in-loop
        await withDiscordRetry(() => msg.reply(part), { phase: 'reply_continuation' });
        rest = rest.slice(maxLen);
      }

      sentTail = tail.length;
    });
  };

  await onChunk((t) => {
    text += t;
    scheduleFlush(false);
  });
  await flush(true);
  if (scheduled) clearTimeoutFn(scheduled);
}

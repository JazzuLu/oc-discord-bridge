import type { Message } from 'discord.js';

/**
 * Issue #406: Only forward meaningful, user-authored text.
 *
 * We intentionally ignore messages that are "non-content" from a prompting perspective:
 * - empty/whitespace-only
 * - sticker-only / embed-only / attachment-only when content is empty
 * - system messages
 * - bot/webhook messages when configured (handled upstream, but supported here too)
 */
export function hasMeaningfulUserText(m: Pick<Message, 'content' | 'system' | 'author' | 'webhookId'>): boolean {
  // Discord system messages (pins, joins, etc.) should never be forwarded.
  if ((m as any)?.system) return false;

  // Treat webhook messages as non-user authored. (Some may not be bots, but they aren't a human user.)
  if ((m as any)?.webhookId) return false;

  const content = String((m as any)?.content ?? '').trim();
  if (!content) return false;

  return true;
}

function formatBytes(n: any): string {
  const bytes = typeof n === 'number' && Number.isFinite(n) ? n : null;
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const rounded = i === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return `${rounded}${units[i]}`;
}

export function buildPromptTextFromMessage(
  m: Pick<Message, 'content' | 'attachments'>,
  opts?: { includeAttachments?: boolean },
): string {
  const content = String((m as any)?.content ?? '').trim();
  if (!content) return '';

  const includeAttachments = opts?.includeAttachments ?? true;
  if (!includeAttachments) return content;

  const attachments = Array.from((m as any)?.attachments?.values?.() ?? []);
  if (attachments.length === 0) return content;

  const attachmentText = `\n\n[Attachments]\n${attachments
    .map((a: any) => {
      const name = a?.name ?? 'file';
      const type = a?.contentType ? String(a.contentType) : '';
      const size = formatBytes(a?.size);
      const meta = [type, size].filter(Boolean).join(', ');
      return `- ${name}${meta ? ` (${meta})` : ''}: ${a?.url ?? ''}`.trimEnd();
    })
    .join('\n')}`;

  return `${content}${attachmentText}`.trim();
}

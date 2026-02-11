export const TOPIC_MAX = 1024;

export function parseCwdFromTopic(topic: string | null | undefined): string | null {
  if (!topic) return null;
  const line = topic
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.startsWith('CWD='));
  if (!line) return null;
  const cwd = line.slice('CWD='.length).trim();
  return cwd || null;
}

/** Build a new topic string with the CWD= line replaced or appended. */
export function buildTopicWithCwd(existing: string | null | undefined, cwd: string): string {
  const cwdLine = `CWD=${cwd}`;

  // Split into lines; remove ALL existing CWD= lines to avoid accumulating duplicates.
  const rawLines = (existing ?? '').split(/\r?\n/);
  const nonCwdLines = rawLines.filter((l) => !l.trimStart().startsWith('CWD='));

  // Keep the topic stable-ish by appending our CWD line to the end.
  const lines = [...nonCwdLines, cwdLine];

  let topic = lines.join('\n');

  // Respect Discord 1024 char limit: trim older non-CWD lines from the top.
  while (topic.length > TOPIC_MAX) {
    const parts = topic.split('\n');
    const removed = parts.findIndex((l) => !l.trimStart().startsWith('CWD='));
    if (removed < 0) break; // only CWD lines remain; nothing else to trim
    parts.splice(removed, 1);
    topic = parts.join('\n');
  }

  return topic.slice(0, TOPIC_MAX);
}

/** Tolerant check: treat "main", "main ...", "main-…", "main:…" as the canonical main thread. */
export function isMainThreadName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  return n === 'main' || n.startsWith('main ') || n.startsWith('main-') || n.startsWith('main:');
}

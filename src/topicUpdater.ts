import type { TextChannel } from 'discord.js';
import { buildTopicWithCwd } from './topic.js';

type EnqueuedPromise<T> = Promise<T>;

export type TopicUpdateResult =
  | { status: 'skipped' }
  | { status: 'updated'; attempts: number }
  | { status: 'failed'; err: unknown };

const channelTopicQueues = new Map<string, EnqueuedPromise<TopicUpdateResult>>();

const MAX_ATTEMPTS = 4;
const RATE_LIMIT_BACKOFF_BASE_MS = 40;
const RATE_LIMIT_BACKOFF_JITTER_MS = 30;
const RATE_LIMIT_MAX_DELAY_MS = 5_000;

function enqueueTopicTask(channelId: string, task: () => Promise<TopicUpdateResult>): EnqueuedPromise<TopicUpdateResult> {
  const prev = channelTopicQueues.get(channelId) ?? Promise.resolve();
  const next = prev.then(() => task(), () => task());
  channelTopicQueues.set(
    channelId,
    next.finally(() => {
      if (channelTopicQueues.get(channelId) === next) channelTopicQueues.delete(channelId);
    }),
  );
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function defaultBackoff(attempt: number): number {
  const base = RATE_LIMIT_BACKOFF_BASE_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * RATE_LIMIT_BACKOFF_JITTER_MS);
  return Math.min(RATE_LIMIT_MAX_DELAY_MS, base + jitter);
}

function parseRetryAfter(err: any): number | null {
  if (!err || typeof err !== 'object') return null;

  const raw = err.rawError ?? err;
  if (raw && typeof raw === 'object') {
    const retry = (raw as any).retry_after ?? (raw as any).retryAfter;
    if (typeof retry === 'number' && !Number.isNaN(retry)) {
      return retry * 1_000;
    }
  }

  const fallback = (err as any).retry_after ?? (err as any).retryAfter;
  if (typeof fallback === 'number' && !Number.isNaN(fallback)) {
    return fallback * 1_000;
  }

  const headers = (err as any).headers;
  if (headers && typeof headers?.get === 'function') {
    const header = headers.get('Retry-After') ?? headers.get('retry-after');
    if (typeof header === 'string') {
      const parsed = parseFloat(header);
      if (!Number.isNaN(parsed)) return parsed * 1_000;
    }
  }

  return null;
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as any).status ?? (err as any).statusCode ?? (err as any).code;
  if (status === 429) return true;
  const name = (err as any).name;
  if (typeof name === 'string' && /rate.?limit/i.test(name)) return true;
  return false;
}

async function updateTopicWithRetries(channel: TextChannel, topic: string): Promise<{ attempts: number }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await channel.setTopic(topic);
      return { attempts: attempt };
    } catch (err) {
      if (!isRateLimitError(err) || attempt === MAX_ATTEMPTS) throw err;
      const parsed = parseRetryAfter(err);
      const delay = parsed ?? defaultBackoff(attempt);
      await sleep(delay);
    }
  }
  return { attempts: MAX_ATTEMPTS };
}

export async function setChannelTopicSafely(channel: TextChannel, cwd: string): Promise<TopicUpdateResult> {
  return enqueueTopicTask(channel.id, async () => {
    try {
      const fetched = await channel.fetch().catch(() => channel);
      const topic = buildTopicWithCwd(fetched.topic, cwd);
      if (fetched.topic === topic) {
        return { status: 'skipped' };
      }
      const { attempts } = await updateTopicWithRetries(fetched, topic);
      return { status: 'updated', attempts };
    } catch (err) {
      return { status: 'failed', err };
    }
  });
}

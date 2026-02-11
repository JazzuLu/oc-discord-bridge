import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
// Be explicit: tsx/Node cwd differences can make dotenv/config miss the file.
dotenv.config({ path: new URL('../.env', import.meta.url) });
import { loadConfig } from './config.js';
import {
  JsonStore,
  type ChannelCwdMap,
  type ChannelMainThreadMap,
  type PausedChannelsMap,
  type ThreadSessionMap,
} from './storage.js';
import { OpenCodeAcpClient } from './opencodeAcp.js';
import {
  createDiscordClient,
  getThreadAndParentChannel,
  handleInteraction,
  isInScopeGuild,
  registerSlashCommands,
} from './discord.js';
import {
  extractRoleIdsFromInteractionMember,
  extractRoleIdsFromMessageMember,
  isAuthorizedForMessage,
  isAuthorizedForOcSlash,
} from './auth.js';
import { formatCwdValidationError, validateChannelCwd } from './cwd.js';
import type { ChatInputCommandInteraction, Message, TextChannel, ThreadChannel } from 'discord.js';

const cfg = loadConfig(process.env);

const store = new JsonStore(cfg.DATA_DIR);

const FILE_CHANNEL_CWD = 'channelCwd.json';
const FILE_CHANNEL_MAIN_THREAD = 'channelMainThread.json';
const FILE_THREAD_SESSION = 'threadSession.json';
const FILE_PAUSED = 'pausedChannels.json';

import { buildTopicWithCwd, isMainThreadName, parseCwdFromTopic } from './topic.js';
import { hintMissingPermissionForSetTopic, runDiscordPreflightOnce } from './permissions.js';
import { ThreadQueue } from './threadQueue.js';
import { redactSecrets } from './redact.js';

type LogCtx = {
  corr?: string;
  threadId?: string;
  sessionId?: string;
  channelId?: string;
  messageId?: string;
  attempt?: number;
  delayMs?: number;
};

function logInfo(msg: string, ctx: LogCtx = {}): void {
  const parts = [
    '[oc-bridge]',
    msg,
    ctx.corr ? `corr=${ctx.corr}` : null,
    ctx.channelId ? `channel=${ctx.channelId}` : null,
    ctx.threadId ? `thread=${ctx.threadId}` : null,
    ctx.sessionId ? `session=${ctx.sessionId}` : null,
    ctx.messageId ? `msg=${ctx.messageId}` : null,
    typeof ctx.attempt === 'number' ? `attempt=${ctx.attempt}` : null,
    typeof ctx.delayMs === 'number' ? `delayMs=${ctx.delayMs}` : null,
  ].filter(Boolean);
  console.log(parts.join(' '));
}

function safeErrMeta(e: unknown): { err: string; stack?: string } {
  if (e && typeof e === 'object') {
    const anyE = e as any;
    const msg = anyE?.message ? String(anyE.message) : String(e);
    const stack = typeof anyE?.stack === 'string' ? anyE.stack : undefined;
    const cleanedMsg = cfg.REDACT_SECRETS ? redactSecrets(msg) : msg;
    const cleanedStack = cfg.REDACT_SECRETS && stack ? redactSecrets(stack) : stack;
    return {
      err: cleanedMsg.slice(0, 500),
      stack: cleanedStack ? cleanedStack.slice(0, 1500) : undefined,
    };
  }
  const msg = String(e);
  const cleaned = cfg.REDACT_SECRETS ? redactSecrets(msg) : msg;
  return { err: cleaned.slice(0, 500) };
}

function logError(msg: string, ctx: LogCtx & { e?: unknown } = {}): void {
  const { e, ...rest } = ctx;
  const meta = e ? safeErrMeta(e) : undefined;
  const parts = [
    '[oc-bridge]',
    msg,
    rest.corr ? `corr=${rest.corr}` : null,
    rest.channelId ? `channel=${rest.channelId}` : null,
    rest.threadId ? `thread=${rest.threadId}` : null,
    rest.sessionId ? `session=${rest.sessionId}` : null,
    rest.messageId ? `msg=${rest.messageId}` : null,
    typeof (rest as any).attempt === 'number' ? `attempt=${(rest as any).attempt}` : null,
    typeof (rest as any).delayMs === 'number' ? `delayMs=${(rest as any).delayMs}` : null,
    meta?.err ? `err=${meta.err}` : null,
  ].filter(Boolean);
  console.error(parts.join(' '));
  if (meta?.stack) console.error(meta.stack);
}

function formatBytes(n?: number): string {
  if (!Number.isFinite(n) || (n ?? 0) <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n as number;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : i === 1 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    attempts: number;
    baseDelayMs: number;
    onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
  },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= opts.attempts) break;
      const base = opts.baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 150);
      const delay = Math.min(5_000, base + jitter);
      opts.onRetry?.({ attempt, delayMs: delay, err: e });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Per-channel lock for findOrCreateMainThread to prevent duplicate thread creation
 * when multiple messages arrive concurrently for the same parent channel.
 */
const mainThreadLocks = new Map<string, Promise<ThreadChannel | null>>();

function allowUser(userId: string, memberRoleIds?: string[]): boolean {
  return isAuthorizedForMessage(cfg, userId, memberRoleIds);
}

function allowParentChannel(channelId: string): boolean {
  const allow = cfg.DISCORD_ALLOW_CHANNEL_IDS;
  if (!allow || allow.length === 0) return true;
  return allow.includes(channelId);
}

async function upsertChannelCwd(channelId: string, cwd: string): Promise<void> {
  await store.updateJson<ChannelCwdMap>(FILE_CHANNEL_CWD, {}, (map) => {
    map[channelId] = { cwd, updatedAt: Date.now() };
    return map;
  });
}

async function upsertChannelMainThread(channelId: string, threadId: string): Promise<void> {
  await store.updateJson<ChannelMainThreadMap>(FILE_CHANNEL_MAIN_THREAD, {}, (map) => {
    map[channelId] = { threadId, updatedAt: Date.now() };
    return map;
  });
}

async function getChannelMainThreadId(channelId: string): Promise<string | null> {
  const map = await store.readJson<ChannelMainThreadMap>(FILE_CHANNEL_MAIN_THREAD, {});
  return map[channelId]?.threadId ?? null;
}

async function getChannelCwd(channelId: string, topic: string | null | undefined): Promise<string | null> {
  const fromTopic = parseCwdFromTopic(topic);
  if (fromTopic) {
    const v = await validateChannelCwd(cfg, fromTopic);
    if (v.ok) {
      await upsertChannelCwd(channelId, v.cwd);
      return v.cwd;
    }
    // Ignore invalid topic CWD (security hardening, issue #614)
    logError('cwd:invalid_topic_ignored', { channelId, e: { reason: v.reason } });
  }

  const map = await store.readJson<ChannelCwdMap>(FILE_CHANNEL_CWD, {});
  const stored = map[channelId]?.cwd;
  if (stored) {
    const v = await validateChannelCwd(cfg, stored);
    if (v.ok) return v.cwd;
    logError('cwd:invalid_stored_ignored', { channelId, e: { reason: v.reason } });
  }

  const def = cfg.OPENCODE_DEFAULT_CWD ?? null;
  if (def) {
    const v = await validateChannelCwd(cfg, def);
    if (v.ok) return v.cwd;
    logError('cwd:invalid_default_ignored', { channelId, e: { reason: v.reason } });
  }

  return null;
}

async function isChannelPaused(channelId: string): Promise<boolean> {
  const paused = await store.readJson<PausedChannelsMap>(FILE_PAUSED, {});
  return paused[channelId] === true;
}

async function setChannelPaused(channelId: string, on: boolean): Promise<void> {
  await store.updateJson<PausedChannelsMap>(FILE_PAUSED, {}, (paused) => {
    if (on) paused[channelId] = true;
    else delete paused[channelId];
    return paused;
  });
}

async function getThreadBinding(threadId: string): Promise<ThreadSessionMap[string] | null> {
  const map = await store.readJson<ThreadSessionMap>(FILE_THREAD_SESSION, {});
  return map[threadId] ?? null;
}

async function setThreadBinding(threadId: string, binding: ThreadSessionMap[string]): Promise<void> {
  await store.updateJson<ThreadSessionMap>(FILE_THREAD_SESSION, {}, (map) => {
    map[threadId] = binding;
    return map;
  });
}

async function ensureThreadSession(oc: OpenCodeAcpClient, thread: ThreadChannel, parent: TextChannel) {
  const existing = await getThreadBinding(thread.id);
  const cwd = await getChannelCwd(parent.id, parent.topic);

  if (cfg.DISCORD_IGNORE_CHANNELS_WITHOUT_CWD && !cwd) {
    return { ok: false as const, reason: 'no_cwd' as const };
  }

  if (existing && existing.cwd && existing.sessionId) {
    // Remember this binding so watchdog restarts can re-load it proactively.
    oc.trackSession(existing.sessionId, existing.cwd, { threadId: thread.id, channelId: parent.id });
    // optimistic: assume still valid; we'll session/load right before prompting.
    return { ok: true as const, binding: existing };
  }

  // Ensure ACP is running before creating a new session.
  await oc.start({ watchdog: true });

  if (!cwd) {
    return { ok: false as const, reason: 'no_cwd' as const };
  }

  const res = await oc.newSession(cwd, { threadId: thread.id });
  const now = Date.now();
  const binding = { sessionId: res.sessionId, cwd, createdAt: now, updatedAt: now };
  await setThreadBinding(thread.id, binding);
  return { ok: true as const, binding };
}

/**
 * Locked wrapper: ensures only one findOrCreate runs per parent channel at a time,
 * preventing duplicate 'main' thread creation from concurrent messages.
 */
async function findOrCreateMainThread(parent: TextChannel, m: Message): Promise<ThreadChannel | null> {
  const existing = mainThreadLocks.get(parent.id);
  if (existing) {
    // Another call is already in-flight for this channel; wait for it.
    return existing;
  }

  const promise = findOrCreateMainThreadInner(parent, m);
  mainThreadLocks.set(parent.id, promise);
  try {
    return await promise;
  } finally {
    mainThreadLocks.delete(parent.id);
  }
}

async function findOrCreateMainThreadInner(parent: TextChannel, m: Message): Promise<ThreadChannel | null> {
  const storedId = await getChannelMainThreadId(parent.id);

  const findInCollections = (coll: any, predicate: (t: ThreadChannel) => boolean): ThreadChannel | null => {
    if (!coll) return null;
    const threads: any = coll.threads ?? coll;
    if (!threads) return null;
    // discord.js collections typically have .find
    return (threads.find?.(predicate) as ThreadChannel) ?? null;
  };

  const ensureUnarchived = async (t: ThreadChannel): Promise<void> => {
    if ((t as any).archived) await (t as any).setArchived(false).catch(() => null);
  };

  const tryResolve = async (threadId: string): Promise<ThreadChannel | null> => {
    // discord.js does not support fetching a thread by id via parent.threads.fetch(threadId).
    // Use the global client channel fetch instead.
    try {
      const fetched = await m.client.channels.fetch(threadId).catch(() => null);
      if (fetched && (fetched as any).isThread?.()) {
        const t = fetched as ThreadChannel;
        // Ensure it belongs to this parent channel
        if ((t as any).parentId === parent.id) {
          await ensureUnarchived(t);
          return t;
        }
      }
    } catch {}

    const active = await parent.threads.fetchActive().catch(() => null);
    const inActive = findInCollections(active, (t) => t.id === threadId);
    if (inActive) return inActive;

    // Archived thread listing is paginated; scan a bit deeper to avoid duplicates.
    let before: string | undefined = undefined;
    for (let i = 0; i < 5; i++) {
      const page = await parent.threads.fetchArchived({ limit: 100, before } as any).catch(() => null);
      const inPage = findInCollections(page, (t) => t.id === threadId);
      if (inPage) {
        await ensureUnarchived(inPage);
        return inPage;
      }
      const pageThreads: any = (page as any)?.threads ?? page;
      const last = pageThreads?.last?.() as ThreadChannel | undefined;
      if (!last) break;
      before = last.id;
    }

    return null;
  };

  const findByName = async (): Promise<ThreadChannel | null> => {
    const active = await parent.threads.fetchActive().catch(() => null);
    const byNameActive = findInCollections(active, (t) => isMainThreadName(t.name));
    if (byNameActive) return byNameActive;

    let before: string | undefined = undefined;
    for (let i = 0; i < 5; i++) {
      const page = await parent.threads.fetchArchived({ limit: 100, before } as any).catch(() => null);
      const byName = findInCollections(page, (t) => isMainThreadName(t.name));
      if (byName) return byName;
      const pageThreads: any = (page as any)?.threads ?? page;
      const last = pageThreads?.last?.() as ThreadChannel | undefined;
      if (!last) break;
      before = last.id;
    }

    return null;
  };

  // 1) Stored mapping
  if (storedId) {
    const resolved = await tryResolve(storedId);
    if (resolved) return resolved;
  }

  // 2) Search by (tolerant) name
  const existing = await findByName();
  if (existing) {
    await ensureUnarchived(existing);
    await upsertChannelMainThread(parent.id, existing.id);
    return existing;
  }

  // 3) Create
  const created = await m.startThread({ name: 'main', autoArchiveDuration: 1440 }).catch(() => null);
  if (!created) return null;
  await upsertChannelMainThread(parent.id, created.id);
  return created;
}

function isDiscordRateLimitError(e: any): boolean {
  const status = e?.status ?? e?.httpStatus ?? e?.response?.status;
  return status === 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withDiscordRetry<T>(
  op: () => Promise<T>,
  meta: Record<string, any>,
  opts?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 400;

  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await op();
    } catch (e: any) {
      lastErr = e;

      const retryAfterMs =
        // Discord REST sometimes returns retry_after in seconds.
        typeof e?.retry_after === 'number' ? Math.ceil(e.retry_after * 1000) : null;

      const shouldRetry =
        isDiscordRateLimitError(e) ||
        // transient network-ish issues
        e?.code === 'ETIMEDOUT' ||
        e?.code === 'ECONNRESET' ||
        e?.code === 'ENOTFOUND' ||
        // discord.js REST sometimes surfaces 5xx
        (typeof (e?.status ?? e?.httpStatus) === 'number' && (e.status ?? e.httpStatus) >= 500);

      if (!shouldRetry || attempt === attempts) break;

      const backoff = Math.min(8000, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 250);
      const delayMs = (retryAfterMs ?? backoff) + jitter;
      console.warn(
        `[oc-bridge] discord_retry attempt=${attempt} delayMs=${delayMs} err=${String(e?.message ?? e).slice(0, 200)}`,
      );
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }

  logError('discord_op_failed', { ...meta, e: String(lastErr?.message ?? lastErr) });
  throw lastErr;
}

async function streamToDiscord(
  msg: Message,
  onChunk: (cb: (t: string) => void) => Promise<void>,
): Promise<void> {
  const placeholder = await withDiscordRetry(() => msg.reply('…'), { phase: 'reply_placeholder' });
  let text = '';
  let lastEdit = 0;

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
    scheduled = setTimeout(() => {
      scheduled = null;
      void flush(false);
    }, 1200);
  };

  const flush = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastEdit < 1100) return;
    lastEdit = now;

    const safeText = cfg.REDACT_SECRETS ? redactSecrets(text) : text;

    await serial(async () => {
      if (safeText.length <= 2000) {
        await withDiscordRetry(() => placeholder.edit(safeText || ''), { phase: 'edit_placeholder' });
        return;
      }

      // If too long, finalize current message and continue in new replies.
      // Keep the placeholder capped at 2000.
      const head = safeText.slice(0, 2000);
      await withDiscordRetry(() => placeholder.edit(head), { phase: 'edit_placeholder_head' });
      let rest = safeText.slice(2000);
      while (rest.length > 0) {
        const part = rest.slice(0, 2000);
        // eslint-disable-next-line no-await-in-loop
        await withDiscordRetry(() => msg.reply(part), { phase: 'reply_continuation' });
        rest = rest.slice(2000);
      }
    });
  };

  await onChunk((t) => {
    text += t;
    scheduleFlush(false);
  });
  await flush(true);
  if (scheduled) clearTimeout(scheduled);
}

async function main() {
  const client = createDiscordClient(cfg);
  const oc = new OpenCodeAcpClient(cfg.OPENCODE_BIN, process.cwd(), (msg, meta) => {
    const m = meta ?? {};
    // Keep it line-based and secret-free; truncate noisy fields.
    const parts = [
      '[oc-bridge]',
      msg,
      typeof (m as any).corr === 'string' ? `corr=${String((m as any).corr).slice(0, 32)}` : null,
      typeof (m as any).channelId === 'string' ? `channel=${(m as any).channelId}` : null,
      typeof (m as any).threadId === 'string' ? `thread=${(m as any).threadId}` : null,
      typeof (m as any).messageId === 'string' ? `msg=${(m as any).messageId}` : null,
      typeof (m as any).pid === 'number' ? `pid=${(m as any).pid}` : null,
      typeof (m as any).sessionId === 'string' ? `session=${(m as any).sessionId}` : null,
      typeof (m as any).attempt === 'number' ? `attempt=${(m as any).attempt}` : null,
      typeof (m as any).delayMs === 'number' ? `delayMs=${(m as any).delayMs}` : null,
      typeof (m as any).code === 'number' ? `code=${(m as any).code}` : null,
      typeof (m as any).signal === 'string' ? `signal=${(m as any).signal}` : null,
      typeof (m as any).err === 'string' ? `err=${String((m as any).err).slice(0, 300)}` : null,
      typeof (m as any).line === 'string' ? `line=${String((m as any).line).slice(0, 200)}` : null,
    ].filter(Boolean);
    console.log(parts.join(' '));
  });

  // Preload persisted thread↔session bindings into ACP desiredSessions so watchdog restarts
  // can reload known sessions without waiting for traffic (issue #640).
  try {
    const map = await store.readJson<ThreadSessionMap>(FILE_THREAD_SESSION, {});
    let count = 0;
    for (const [threadId, binding] of Object.entries(map)) {
      if (!binding?.sessionId || !binding?.cwd) continue;
      oc.trackSession(binding.sessionId, binding.cwd, { threadId });
      count += 1;
    }
    if (count > 0) {
      console.log(`[oc-bridge] preload:desiredSessions count=${count}`);
    }
  } catch (e) {
    logError('preload:desiredSessions_failed', { e });
  }

  if (cfg.OPENCODE_ACP_AUTOSTART) {
    await oc.start({ watchdog: true });
  }

  client.on('ready', async () => {
    if (!client.user) return;
    if (cfg.DISCORD_GUILD_ID) {
      await registerSlashCommands(cfg, client.user.id);
    }

    // Preflight: try to surface missing intents / permissions early (no spam).
    await runDiscordPreflightOnce(cfg, client);

    console.log(`[oc-bridge] ready as ${client.user.tag}`);
  });

  client.on('interactionCreate', async (ix) => {
    const corr = randomUUID().slice(0, 8);
    try {
      if (!isInScopeGuild(cfg, ix.guildId)) return;

      // Guard /oc slash commands (issue #270): require explicit allowlist or role membership when configured.
      if (ix.isChatInputCommand() && ix.commandName === 'oc') {
        const roleIds = extractRoleIdsFromInteractionMember(ix.member);
        if (!isAuthorizedForOcSlash(cfg, ix.user.id, roleIds)) {
          await ix.reply({
            content:
              'Unauthorized: /oc is restricted in this server. Ask an admin to add your Discord user ID to DISCORD_ALLOW_USER_IDS (preferred) or add an allowed role ID to DISCORD_ALLOW_ROLE_IDS.',
            ephemeral: true,
          });
          return;
        }
      }

      // Optional: restrict the bridge to an explicit set of parent channels.
      // (Security hardening: prevent accidental "whole-server" enablement.)
      const ixCh = await ix.channel?.fetch?.().catch(() => ix.channel);
      const { parent: ixParent } = getThreadAndParentChannel(ixCh as any);
      if (ixParent && !allowParentChannel(ixParent.id)) return;

      await handleInteraction(ix, {
        status: async (cix: ChatInputCommandInteraction) => {
          const ch = cix.channel;
          const { thread, parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });
          const topicCwd = parseCwdFromTopic(parent.topic);
          const topicCwdValidation = topicCwd ? await validateChannelCwd(cfg, topicCwd) : null;

          const cwd = await getChannelCwd(parent.id, parent.topic);
          const paused = await isChannelPaused(parent.id);
          const binding = thread ? await getThreadBinding(thread.id) : null;

          const lines = [
            `channel: ${parent.id}`,
            `cwd: ${cwd ?? '(none)'}`,
            `paused: ${paused}`,
            `thread: ${thread?.id ?? '(none)'}`,
            `session: ${binding?.sessionId ?? '(none)'}`,
          ];
          if (topicCwd && topicCwdValidation && !topicCwdValidation.ok) {
            lines.push(`topic CWD ignored: ${formatCwdValidationError(topicCwdValidation)}`);
          }

          await cix.reply({
            content: lines.join('\n'),
            ephemeral: true,
          });
        },
        newSession: async (cix) => {
          const ch = cix.channel;
          const { thread, parent } = getThreadAndParentChannel(ch);
          if (!thread || !parent) return void cix.reply({ content: 'Run this inside a thread', ephemeral: true });

          // Must ACK interactions quickly, otherwise Discord shows "该应用程序未响应".
          await cix.deferReply({ ephemeral: true });

          const cwd = await getChannelCwd(parent.id, parent.topic);
          if (!cwd) return void cix.editReply({ content: 'No CWD configured for this channel' });

          const meta = { corr, channelId: parent.id, threadId: thread.id };

          const res = await retryWithBackoff(
            async (attempt) => {
              await oc.start({ watchdog: true });
              return oc.newSession(cwd, { ...meta, attempt });
            },
            {
              attempts: 3,
              baseDelayMs: 300,
              onRetry: ({ attempt, delayMs, err }) => {
                logError('interaction:new_session_retry_scheduled', { ...meta, attempt, delayMs, e: err });
              },
            },
          );

          const now = Date.now();
          await setThreadBinding(thread.id, { sessionId: res.sessionId, cwd, createdAt: now, updatedAt: now });
          await cix.editReply({ content: `Bound thread to NEW session: ${res.sessionId}` });
        },
        switchSession: async (cix) => {
          const ch = cix.channel;
          const { thread, parent } = getThreadAndParentChannel(ch);
          if (!thread || !parent) return void cix.reply({ content: 'Run this inside a thread', ephemeral: true });

          await cix.deferReply({ ephemeral: true });

          const sessionId = cix.options.getString('session_id', true);
          const cwd = await getChannelCwd(parent.id, parent.topic);
          if (!cwd) return void cix.editReply({ content: 'No CWD configured for this channel' });

          const meta = { corr, channelId: parent.id, threadId: thread.id, sessionId };

          await retryWithBackoff(
            async (attempt) => {
              await oc.start({ watchdog: true });
              await oc.loadSession(sessionId, cwd, { ...meta, attempt });
            },
            {
              attempts: 3,
              baseDelayMs: 300,
              onRetry: ({ attempt, delayMs, err }) => {
                logError('interaction:switch_session_retry_scheduled', { ...meta, attempt, delayMs, e: err });
              },
            },
          );

          const now = Date.now();
          await setThreadBinding(thread.id, { sessionId, cwd, createdAt: now, updatedAt: now });
          await cix.editReply({ content: `Bound thread to session: ${sessionId}` });
        },
        pause: async (cix) => {
          const ch = cix.channel;
          const { parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });
          await cix.deferReply({ ephemeral: true });
          await setChannelPaused(parent.id, true);
          await cix.editReply({ content: 'Paused forwarding in this channel' });
        },
        resume: async (cix) => {
          const ch = cix.channel;
          const { parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });
          await cix.deferReply({ ephemeral: true });
          await setChannelPaused(parent.id, false);
          await cix.editReply({ content: 'Resumed forwarding in this channel' });
        },
        cwdSet: async (cix) => {
          const ch = cix.channel;
          const { parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });

          // Must ACK interactions quickly, otherwise Discord shows "该应用程序未响应".
          await cix.deferReply({ ephemeral: true });

          const cwd = cix.options.getString('path', true);
          const v = await validateChannelCwd(cfg, cwd);
          if (!v.ok) {
            return void cix.editReply({
              content: `Rejected CWD: ${formatCwdValidationError(v)}. (Tip: configure DISCORD_ALLOWED_CWD_PREFIXES to restrict allowed roots)`,
            });
          }

          await upsertChannelCwd(parent.id, v.cwd);

          const fullParent = await parent.fetch().catch(() => parent);
          const newTopic = buildTopicWithCwd(fullParent.topic, v.cwd);

          let topicOk = true;
          let topicHint: string | null = null;
          await fullParent.setTopic(newTopic).catch((e: any) => {
            topicOk = false;
            topicHint = hintMissingPermissionForSetTopic(e);
            console.error('[oc-bridge] failed to set channel topic:', e?.message ?? e);
            if (topicHint) {
              console.error(`[oc-bridge] hint: missing permission for topic update: ${topicHint}`);
            }
          });

          await cix.editReply({
            content: topicOk
              ? `Set CWD for channel to: ${v.cwd} (topic updated)`
              : `Set CWD for channel to: ${v.cwd} (WARNING: failed to update channel topic; required permission: ${topicHint ?? 'Manage Channels'})`,
          });
        },
      });
    } catch (e: any) {
      logError('interaction:error', { e });
      try {
        // If we already ACKed the interaction, use editReply.
        // @ts-ignore
        if (ix.isRepliable && ix.isRepliable()) {
          // @ts-ignore
          if (ix.deferred || ix.replied) {
            // @ts-ignore
            await ix.editReply({ content: `Error: ${e?.message ?? String(e)}` });
          } else {
            // @ts-ignore
            await ix.reply({ content: `Error: ${e?.message ?? String(e)}`, ephemeral: true });
          }
        }
      } catch {}
    }
  });

  const threadQueue = new ThreadQueue();

  client.on('messageCreate', async (m: Message) => {
    try {
      if (!isInScopeGuild(cfg, m.guildId)) return;
      if (cfg.DISCORD_IGNORE_BOTS && m.author.bot) return;
      const roleIds = extractRoleIdsFromMessageMember((m as any).member);
      if (!allowUser(m.author.id, roleIds)) return;

      const corr = randomUUID().slice(0, 8);

      // Ensure we have full channel objects (topics on parents are often missing on partials)
      const ch = await m.channel.fetch().catch(() => m.channel);
      let { thread, parent } = getThreadAndParentChannel(ch);
      if (parent && !allowParentChannel(parent.id)) return;

      // If user is already in the canonical 'main' thread, remember it to avoid duplicates.
      if (thread && parent && isMainThreadName(thread.name)) {
        await upsertChannelMainThread(parent.id, thread.id);
      }

      // Convenience: if user talks in a configured text channel, reuse (or create) a main thread
      if (!thread && parent) {
        const cwd = await getChannelCwd(parent.id, (parent as any).topic);
        if (cfg.DISCORD_IGNORE_CHANNELS_WITHOUT_CWD && !cwd) return;
        const mainThread = await findOrCreateMainThread(parent, m);
        if (!mainThread) return;
        thread = mainThread;
      }

      if (!thread || !parent) return;

      // Backpressure: if a thread has too many pending prompts, reject new messages quickly.
      if (threadQueue.depth(thread.id) >= cfg.DISCORD_THREAD_QUEUE_MAX_DEPTH) {
        await withDiscordRetry(() => m.reply('This thread is busy (too many pending messages). Please wait and try again.'), {
          phase: 'thread_backpressure',
          threadId: thread.id,
          channelId: parent.id,
          messageId: m.id,
          corr,
        });
        return;
      }

      await threadQueue.enqueue(thread.id, async () => {
        // Fetch parent to get latest topic (do this inside the queue to preserve ordering).
        const fullParent = await parent.fetch().catch(() => parent);

        if (await isChannelPaused(fullParent.id)) return;

        const ensured = await ensureThreadSession(oc, thread, fullParent);
        if (!ensured.ok) return;

        const { sessionId, cwd } = ensured.binding;
        logInfo('prompt:start', {
          corr,
          channelId: fullParent.id,
          threadId: thread.id,
          sessionId,
          messageId: m.id,
        });

        await streamToDiscord(m, async (emit) => {
          const meta = {
            corr,
            threadId: thread.id,
            channelId: fullParent.id,
            messageId: m.id,
            sessionId,
          };

          await retryWithBackoff(
            async (attempt) => {
              if (attempt > 1) {
                logInfo('prompt:retry', { ...meta, attempt });
              }
              try {
                // If ACP restarted, ensure the session binding is re-loaded before prompting.
                await oc.ensureSessionLoaded(sessionId, cwd, { ...meta, attempt });

                // Include attachment URLs so prompts like "see screenshot" have context.
                const attachments = Array.from(m.attachments?.values?.() ?? []);
                const attachmentText =
                  attachments.length === 0
                    ? ''
                    : `\n\n[Attachments]\n${attachments
                        .map((a) => {
                          const name = a.name ?? 'file';
                          const type = (a as any)?.contentType ? String((a as any).contentType) : '';
                          const size = formatBytes((a as any)?.size);
                          const meta = [type, size].filter(Boolean).join(', ');
                          return `- ${name}${meta ? ` (${meta})` : ''}: ${a.url}`;
                        })
                        .join('\n')}`;
                const promptText = `${m.content ?? ''}${attachmentText}`.trim();

                // If message has no text and no attachments, do nothing.
                if (!promptText) return;

                await oc.prompt(sessionId, promptText, emit, { ...meta, attempt });
              } catch (e) {
                logError('prompt:attempt_failed', { ...meta, e });
                throw e;
              }
            },
            {
              attempts: 3,
              baseDelayMs: 300,
              onRetry: ({ attempt, delayMs, err }) => {
                // Log retry scheduling with correlation ids (no secrets).
                logError('prompt:retry_scheduled', { ...meta, attempt, delayMs, e: err });
              },
            },
          );
        });

        const now = Date.now();
        await setThreadBinding(thread.id, { ...ensured.binding, updatedAt: now });
      });
    } catch (e) {
      logError('message:error', { e });
    }
  });

  await client.login(cfg.DISCORD_BOT_TOKEN);
}

main().catch((e) => {
  logError('fatal', { e });
  process.exit(1);
});

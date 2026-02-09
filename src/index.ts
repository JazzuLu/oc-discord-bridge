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
import type { ChatInputCommandInteraction, Message, TextChannel, ThreadChannel } from 'discord.js';

const cfg = loadConfig(process.env);
const store = new JsonStore(cfg.DATA_DIR);

const FILE_CHANNEL_CWD = 'channelCwd.json';
const FILE_CHANNEL_MAIN_THREAD = 'channelMainThread.json';
const FILE_THREAD_SESSION = 'threadSession.json';
const FILE_PAUSED = 'pausedChannels.json';

const TOPIC_MAX = 1024;

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
    return { err: msg.slice(0, 500), stack: stack ? stack.slice(0, 1500) : undefined };
  }
  return { err: String(e).slice(0, 500) };
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

function parseCwdFromTopic(topic: string | null | undefined): string | null {
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
function buildTopicWithCwd(existing: string | null | undefined, cwd: string): string {
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

function allowUser(userId: string): boolean {
  const allow = cfg.DISCORD_ALLOW_USER_IDS;
  if (!allow || allow.length === 0) return true;
  return allow.includes(userId);
}

async function upsertChannelCwd(channelId: string, cwd: string): Promise<void> {
  const map = await store.readJson<ChannelCwdMap>(FILE_CHANNEL_CWD, {});
  map[channelId] = { cwd, updatedAt: Date.now() };
  await store.writeJson(FILE_CHANNEL_CWD, map);
}

async function upsertChannelMainThread(channelId: string, threadId: string): Promise<void> {
  const map = await store.readJson<ChannelMainThreadMap>(FILE_CHANNEL_MAIN_THREAD, {});
  map[channelId] = { threadId, updatedAt: Date.now() };
  await store.writeJson(FILE_CHANNEL_MAIN_THREAD, map);
}

async function getChannelMainThreadId(channelId: string): Promise<string | null> {
  const map = await store.readJson<ChannelMainThreadMap>(FILE_CHANNEL_MAIN_THREAD, {});
  return map[channelId]?.threadId ?? null;
}

async function getChannelCwd(channelId: string, topic: string | null | undefined): Promise<string | null> {
  const fromTopic = parseCwdFromTopic(topic);
  if (fromTopic) {
    await upsertChannelCwd(channelId, fromTopic);
    return fromTopic;
  }
  const map = await store.readJson<ChannelCwdMap>(FILE_CHANNEL_CWD, {});
  return map[channelId]?.cwd ?? cfg.OPENCODE_DEFAULT_CWD ?? null;
}

async function isChannelPaused(channelId: string): Promise<boolean> {
  const paused = await store.readJson<PausedChannelsMap>(FILE_PAUSED, {});
  return paused[channelId] === true;
}

async function setChannelPaused(channelId: string, on: boolean): Promise<void> {
  const paused = await store.readJson<PausedChannelsMap>(FILE_PAUSED, {});
  if (on) paused[channelId] = true;
  else delete paused[channelId];
  await store.writeJson(FILE_PAUSED, paused);
}

async function getThreadBinding(threadId: string): Promise<ThreadSessionMap[string] | null> {
  const map = await store.readJson<ThreadSessionMap>(FILE_THREAD_SESSION, {});
  return map[threadId] ?? null;
}

async function setThreadBinding(threadId: string, binding: ThreadSessionMap[string]): Promise<void> {
  const map = await store.readJson<ThreadSessionMap>(FILE_THREAD_SESSION, {});
  map[threadId] = binding;
  await store.writeJson(FILE_THREAD_SESSION, map);
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

async function findOrCreateMainThread(parent: TextChannel, m: Message): Promise<ThreadChannel | null> {
  const storedId = await getChannelMainThreadId(parent.id);

  const findInCollections = (coll: any, predicate: (t: ThreadChannel) => boolean): ThreadChannel | null => {
    if (!coll) return null;
    const threads: any = coll.threads ?? coll;
    if (!threads) return null;
    // discord.js collections typically have .find
    return (threads.find?.(predicate) as ThreadChannel) ?? null;
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
          if ((t as any).archived) await (t as any).setArchived(false).catch(() => null);
          return t;
        }
      }
    } catch {}

    const active = await parent.threads.fetchActive().catch(() => null);
    const inActive = findInCollections(active, (t) => t.id === threadId);
    if (inActive) return inActive;

    const archived = await parent.threads.fetchArchived({ limit: 100 }).catch(() => null);
    const inArchived = findInCollections(archived, (t) => t.id === threadId);
    if (inArchived) {
      if ((inArchived as any).archived) await inArchived.setArchived(false).catch(() => null);
      return inArchived;
    }

    return null;
  };

  // 1) Stored mapping
  if (storedId) {
    const resolved = await tryResolve(storedId);
    if (resolved) return resolved;
  }

  // 2) Search by name
  const active = await parent.threads.fetchActive().catch(() => null);
  const byNameActive = findInCollections(active, (t) => t.name === 'main');
  if (byNameActive) {
    await upsertChannelMainThread(parent.id, byNameActive.id);
    return byNameActive;
  }

  const archived = await parent.threads.fetchArchived({ limit: 100 }).catch(() => null);
  const byNameArchived = findInCollections(archived, (t) => t.name === 'main');
  if (byNameArchived) {
    if ((byNameArchived as any).archived) await byNameArchived.setArchived(false).catch(() => null);
    await upsertChannelMainThread(parent.id, byNameArchived.id);
    return byNameArchived;
  }

  // 3) Create
  const created = await m.startThread({ name: 'main', autoArchiveDuration: 1440 }).catch(() => null);
  if (!created) return null;
  await upsertChannelMainThread(parent.id, created.id);
  return created;
}

async function streamToDiscord(
  msg: Message,
  onChunk: (cb: (t: string) => void) => Promise<void>,
): Promise<void> {
  const placeholder = await msg.reply('…');
  let text = '';
  let lastEdit = 0;

  const flush = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastEdit < 350) return;
    lastEdit = now;

    if (text.length <= 2000) {
      await placeholder.edit(text || '');
      return;
    }

    // If too long, finalize current message and continue in new replies.
    // Keep the placeholder capped at 2000.
    const head = text.slice(0, 2000);
    await placeholder.edit(head);
    let rest = text.slice(2000);
    while (rest.length > 0) {
      const part = rest.slice(0, 2000);
      // eslint-disable-next-line no-await-in-loop
      await msg.reply(part);
      rest = rest.slice(2000);
    }
  };

  await onChunk((t) => {
    text += t;
    void flush(false);
  });
  await flush(true);
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

  if (cfg.OPENCODE_ACP_AUTOSTART) {
    await oc.start({ watchdog: true });
  }

  client.on('ready', async () => {
    if (!client.user) return;
    if (cfg.DISCORD_GUILD_ID) {
      await registerSlashCommands(cfg, client.user.id);
    }
    console.log(`[oc-bridge] ready as ${client.user.tag}`);
  });

  client.on('interactionCreate', async (ix) => {
    const corr = randomUUID().slice(0, 8);
    try {
      if (!isInScopeGuild(cfg, ix.guildId)) return;
      await handleInteraction(ix, {
        status: async (cix: ChatInputCommandInteraction) => {
          const ch = cix.channel;
          const { thread, parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });
          const cwd = await getChannelCwd(parent.id, parent.topic);
          const paused = await isChannelPaused(parent.id);
          const binding = thread ? await getThreadBinding(thread.id) : null;
          await cix.reply({
            content: [
              `channel: ${parent.id}`,
              `cwd: ${cwd ?? '(none)'}`,
              `paused: ${paused}`,
              `thread: ${thread?.id ?? '(none)'}`,
              `session: ${binding?.sessionId ?? '(none)'}`,
            ].join('\n'),
            ephemeral: true,
          });
        },
        newSession: async (cix) => {
          const ch = cix.channel;
          const { thread, parent } = getThreadAndParentChannel(ch);
          if (!thread || !parent) return void cix.reply({ content: 'Run this inside a thread', ephemeral: true });
          const cwd = await getChannelCwd(parent.id, parent.topic);
          if (!cwd) return void cix.reply({ content: 'No CWD configured for this channel', ephemeral: true });

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
          await cix.reply({ content: `Bound thread to NEW session: ${res.sessionId}`, ephemeral: true });
        },
        switchSession: async (cix) => {
          const ch = cix.channel;
          const { thread, parent } = getThreadAndParentChannel(ch);
          if (!thread || !parent) return void cix.reply({ content: 'Run this inside a thread', ephemeral: true });
          const sessionId = cix.options.getString('session_id', true);
          const cwd = await getChannelCwd(parent.id, parent.topic);
          if (!cwd) return void cix.reply({ content: 'No CWD configured for this channel', ephemeral: true });

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
          await cix.reply({ content: `Bound thread to session: ${sessionId}`, ephemeral: true });
        },
        pause: async (cix) => {
          const ch = cix.channel;
          const { parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });
          await setChannelPaused(parent.id, true);
          await cix.reply({ content: 'Paused forwarding in this channel', ephemeral: true });
        },
        resume: async (cix) => {
          const ch = cix.channel;
          const { parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });
          await setChannelPaused(parent.id, false);
          await cix.reply({ content: 'Resumed forwarding in this channel', ephemeral: true });
        },
        cwdSet: async (cix) => {
          const ch = cix.channel;
          const { parent } = getThreadAndParentChannel(ch);
          if (!parent) return void cix.reply({ content: 'Not a text channel/thread', ephemeral: true });
          const cwd = cix.options.getString('path', true);

          await upsertChannelCwd(parent.id, cwd);

          const fullParent = await parent.fetch().catch(() => parent);
          const newTopic = buildTopicWithCwd(fullParent.topic, cwd);

          let topicOk = true;
          await fullParent.setTopic(newTopic).catch((e: any) => {
            topicOk = false;
            console.error('[oc-bridge] failed to set channel topic:', e?.message ?? e);
          });

          await cix.reply({
            content: topicOk
              ? `Set CWD for channel to: ${cwd} (topic updated)`
              : `Set CWD for channel to: ${cwd} (WARNING: failed to update channel topic; check bot permissions)`,
            ephemeral: true,
          });
        },
      });
    } catch (e: any) {
      logError('interaction:error', { e });
      try {
        // @ts-ignore
        if (ix.isRepliable()) await ix.reply({ content: `Error: ${e?.message ?? String(e)}`, ephemeral: true });
      } catch {}
    }
  });

  client.on('messageCreate', async (m: Message) => {
    try {
      if (!isInScopeGuild(cfg, m.guildId)) return;
      if (cfg.DISCORD_IGNORE_BOTS && m.author.bot) return;
      if (!allowUser(m.author.id)) return;

      const corr = randomUUID().slice(0, 8);

      // Ensure we have full channel objects (topics on parents are often missing on partials)
      const ch = await m.channel.fetch().catch(() => m.channel);
      let { thread, parent } = getThreadAndParentChannel(ch);

      // If user is already in the canonical 'main' thread, remember it to avoid duplicates.
      if (thread && parent && thread.name === 'main') {
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

      // Fetch parent to get latest topic
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
              await oc.prompt(sessionId, m.content, emit, { ...meta, attempt });
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

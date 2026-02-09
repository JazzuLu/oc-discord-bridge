import dotenv from 'dotenv';
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
    // optimistic: assume still valid; load lazily only if needed later
    return { ok: true as const, binding: existing };
  }

  if (!cwd) {
    return { ok: false as const, reason: 'no_cwd' as const };
  }

  const res = await oc.newSession(cwd);
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
  const oc = new OpenCodeAcpClient(cfg.OPENCODE_BIN, process.cwd());

  if (cfg.OPENCODE_ACP_AUTOSTART) {
    oc.start();
    await oc.initialize();
  }

  client.on('ready', async () => {
    if (!client.user) return;
    if (cfg.DISCORD_GUILD_ID) {
      await registerSlashCommands(cfg, client.user.id);
    }
    console.log(`[oc-bridge] ready as ${client.user.tag}`);
  });

  client.on('interactionCreate', async (ix) => {
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
          const res = await oc.newSession(cwd);
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
          await oc.loadSession(sessionId, cwd);
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
      console.error(e);
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

      await streamToDiscord(m, async (emit) => {
        await oc.prompt(ensured.binding.sessionId, m.content, emit);
      });

      const now = Date.now();
      await setThreadBinding(thread.id, { ...ensured.binding, updatedAt: now });
    } catch (e) {
      console.error(e);
    }
  });

  await client.login(cfg.DISCORD_BOT_TOKEN);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

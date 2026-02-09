import dotenv from 'dotenv';
// Be explicit: tsx/Node cwd differences can make dotenv/config miss the file.
dotenv.config({ path: new URL('../.env', import.meta.url) });
import { loadConfig } from './config.js';
import { JsonStore, type ChannelCwdMap, type PausedChannelsMap, type ThreadSessionMap } from './storage.js';
import { OpenCodeAcpClient } from './opencodeAcp.js';
import {
  createDiscordClient,
  getThreadAndParentChannel,
  handleInteraction,
  isInScopeGuild,
  registerSlashCommands,
} from './discord.js';
import type { ChatInputCommandInteraction, Message, TextChannel, ThreadChannel } from 'discord.js';
import path from 'node:path';

const cfg = loadConfig(process.env);
const store = new JsonStore(cfg.DATA_DIR);

const FILE_CHANNEL_CWD = 'channelCwd.json';
const FILE_THREAD_SESSION = 'threadSession.json';
const FILE_PAUSED = 'pausedChannels.json';

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
          await cix.reply({ content: `Set CWD for channel to: ${cwd}`, ephemeral: true });
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

      // Convenience: if user talks in a configured text channel, auto-create a thread
      if (!thread && parent) {
        const cwd = await getChannelCwd(parent.id, (parent as any).topic);
        if (cfg.DISCORD_IGNORE_CHANNELS_WITHOUT_CWD && !cwd) return;
        // Start a thread from this message so thread=session holds.
        const created = await m.startThread({ name: 'main', autoArchiveDuration: 1440 }).catch(() => null);
        if (!created) return;
        thread = created;
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

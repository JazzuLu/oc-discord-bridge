import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  Interaction,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import type { Message } from 'discord.js';
import type { Config } from './config.js';

export type SlashHandlers = {
  status: (ix: ChatInputCommandInteraction) => Promise<void>;
  newSession: (ix: ChatInputCommandInteraction) => Promise<void>;
  switchSession: (ix: ChatInputCommandInteraction) => Promise<void>;
  pause: (ix: ChatInputCommandInteraction) => Promise<void>;
  resume: (ix: ChatInputCommandInteraction) => Promise<void>;
  cwdSet: (ix: ChatInputCommandInteraction) => Promise<void>;
};

export function createDiscordClient(cfg: Config): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
}

export async function registerSlashCommands(cfg: Config, clientId: string): Promise<void> {
  if (!cfg.DISCORD_GUILD_ID) return; // register guild-scoped only

  const commands = [
    new SlashCommandBuilder().setName('oc').setDescription('OpenCode bridge controls')
      .addSubcommand((s) => s.setName('status').setDescription('Show mapping status'))
      .addSubcommand((s) => s.setName('new').setDescription('Create a new OpenCode session for this thread'))
      .addSubcommand((s) =>
        s
          .setName('switch')
          .setDescription('Bind this thread to an existing OpenCode session')
          .addStringOption((o) => o.setName('session_id').setDescription('OpenCode session id').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('pause').setDescription('Pause forwarding in this channel'))
      .addSubcommand((s) => s.setName('resume').setDescription('Resume forwarding in this channel'))
      .addSubcommand((s) =>
        s
          .setName('cwd')
          .setDescription('Set cwd for this channel')
          .addStringOption((o) => o.setName('path').setDescription('Absolute path').setRequired(true)),
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(cfg.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(clientId, cfg.DISCORD_GUILD_ID), { body: commands });
}

export function isInScopeGuild(cfg: Config, guildId: string | null): boolean {
  if (!cfg.DISCORD_GUILD_ID) return true;
  return guildId === cfg.DISCORD_GUILD_ID;
}

export function getThreadAndParentChannel(
  ch: any,
): { thread: ThreadChannel | null; parent: TextChannel | null } {
  if (!ch) return { thread: null, parent: null };
  if (ch.type === ChannelType.PublicThread || ch.type === ChannelType.PrivateThread) {
    const thread = ch as ThreadChannel;
    const parent = thread.parent;
    return { thread, parent: parent && parent.type === ChannelType.GuildText ? (parent as TextChannel) : null };
  }
  if (ch.type === ChannelType.GuildText) {
    // allow using channel directly; but our design uses thread=session, so we create threads or ignore
    return { thread: null, parent: ch as TextChannel };
  }
  return { thread: null, parent: null };
}

export async function handleInteraction(ix: Interaction, handlers: SlashHandlers): Promise<void> {
  if (!ix.isChatInputCommand()) return;
  if (ix.commandName !== 'oc') return;

  const sub = ix.options.getSubcommand();
  if (sub === 'status') return handlers.status(ix);
  if (sub === 'new') return handlers.newSession(ix);
  if (sub === 'switch') return handlers.switchSession(ix);
  if (sub === 'pause') return handlers.pause(ix);
  if (sub === 'resume') return handlers.resume(ix);
  if (sub === 'cwd') return handlers.cwdSet(ix);
}

export type StreamToDiscordOptions = {
  /** Correlation id shown to the user on failure. */
  corr?: string;
  /**
   * Additional metadata passed through to withDiscordRetry for logging.
   * Should be small and free of secrets.
   */
  meta?: Record<string, any>;
  /**
   * If provided, all Discord writes go through this wrapper.
   * (Bridge uses it for rate-limit/network retries.)
   */
  withDiscordRetry?: <T>(op: () => Promise<T>, meta: Record<string, any>) => Promise<T>;
  /** Apply output redaction (if enabled) before writing to Discord. */
  redactSecrets?: boolean;
  /** Redaction function used when redactSecrets=true. */
  redact?: (input: string) => string;
};

function formatPromptFailureMessage(corr?: string): string {
  const id = typeof corr === 'string' ? corr.trim().slice(0, 32) : '';
  const corrPart = id ? ` (corr=${id})` : '';
  // Keep it generic: no stack traces, no exception messages, no config paths.
  return (
    `Sorry — the bridge hit an internal error while processing your prompt${corrPart}.\n` +
    `Please try again. If this keeps happening, ask an admin to check the bridge logs using the correlation id.`
  );
}

export async function streamToDiscord(
  msg: Message,
  onChunk: (cb: (t: string) => void) => Promise<void>,
  opts: StreamToDiscordOptions = {},
): Promise<void> {
  const baseMeta = opts.meta ?? {};
  const corr = opts.corr ?? (typeof (baseMeta as any).corr === 'string' ? String((baseMeta as any).corr) : undefined);

  const withRetry =
    opts.withDiscordRetry ??
    (async <T>(op: () => Promise<T>) => {
      return op();
    });

  const placeholder = await withRetry(() => msg.reply('…'), { ...baseMeta, phase: 'reply_placeholder' });

  let text = '';
  let lastEdit = 0;
  let failed = false;

  // Serialize Discord writes for this stream to avoid overlapping edits/replies under burst.
  let q: Promise<void> = Promise.resolve();
  const serial = (fn: () => Promise<void>) => {
    q = q.then(fn, fn);
    return q;
  };

  let scheduled: NodeJS.Timeout | null = null;
  const scheduleFlush = (force = false) => {
    if (failed) return;
    if (force) return void flush(true);
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      void flush(false);
    }, 1200);
  };

  const flush = async (force = false) => {
    if (failed) return;
    const now = Date.now();
    if (!force && now - lastEdit < 1100) return;
    lastEdit = now;

    const safeText = opts.redactSecrets && opts.redact ? opts.redact(text) : text;

    await serial(async () => {
      if (safeText.length <= 2000) {
        await withRetry(() => (placeholder as any).edit(safeText || ''), { ...baseMeta, phase: 'edit_placeholder' });
        return;
      }

      // If too long, finalize current message and continue in new replies.
      // Keep the placeholder capped at 2000.
      const head = safeText.slice(0, 2000);
      await withRetry(() => (placeholder as any).edit(head), { ...baseMeta, phase: 'edit_placeholder_head' });
      let rest = safeText.slice(2000);
      while (rest.length > 0) {
        const part = rest.slice(0, 2000);
        // eslint-disable-next-line no-await-in-loop
        await withRetry(() => msg.reply(part), { ...baseMeta, phase: 'reply_continuation' });
        rest = rest.slice(2000);
      }
    });
  };

  try {
    await onChunk((t) => {
      text += t;
      scheduleFlush(false);
    });

    await flush(true);
  } catch (e) {
    failed = true;
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }

    // Best-effort: overwrite the placeholder so the user isn't left with "…".
    // Do not include exception details (may contain secrets).
    // Use the same serial queue so the error message "wins" over any in-flight flush edits.
    try {
      await serial(async () => {
        await withRetry(
          () => (placeholder as any).edit(formatPromptFailureMessage(corr)),
          { ...baseMeta, phase: 'edit_placeholder_error' },
        );
      });
    } catch {
      // ignore: original error will be logged upstream
    }

    throw e;
  } finally {
    if (scheduled) clearTimeout(scheduled);
  }
}

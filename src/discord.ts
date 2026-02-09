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

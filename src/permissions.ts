import {
  GatewayIntentBits,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type Guild,
  type GuildMember,
} from 'discord.js';

import type { Config } from './config.js';

export const REQUIRED_GUILD_PERMISSIONS = [
  { bit: PermissionFlagsBits.ViewChannel, name: 'View Channels' },
  { bit: PermissionFlagsBits.ReadMessageHistory, name: 'Read Message History' },
  { bit: PermissionFlagsBits.SendMessages, name: 'Send Messages' },
  // Used if the bridge creates / manages threads.
  { bit: PermissionFlagsBits.CreatePublicThreads, name: 'Create Public Threads' },
  { bit: PermissionFlagsBits.SendMessagesInThreads, name: 'Send Messages in Threads' },
  { bit: PermissionFlagsBits.ManageThreads, name: 'Manage Threads' },
  // Used only for updating channel topic (CWD=...).
  { bit: PermissionFlagsBits.ManageChannels, name: 'Manage Channels' },
] as const;

export function getMissingGuildPermissions(me: GuildMember): string[] {
  const perms = me.permissions;
  return REQUIRED_GUILD_PERMISSIONS.filter(({ bit }) => !perms.has(bit)).map(({ name }) => name);
}

export function hasMessageContentIntent(client: Client): boolean {
  // Note: This only checks the intents requested by the bot at runtime.
  // The app still must enable Message Content Intent in the Dev Portal.
  return client.options.intents.has(GatewayIntentBits.MessageContent);
}

/**
 * Best-effort extraction of a helpful permission name for common Discord API failures.
 * Currently only handles topic updates (Manage Channels).
 */
export function hintMissingPermissionForSetTopic(err: any): string | null {
  const code = (err && typeof err === 'object' && 'code' in err ? (err as any).code : undefined) as
    | number
    | string
    | undefined;
  const msg = (err && typeof err === 'object' && 'message' in err ? (err as any).message : undefined) as
    | string
    | undefined;

  // Discord API error code for Missing Permissions.
  if (code === 50013 || code === '50013') return 'Manage Channels';
  if (typeof msg === 'string' && /missing permissions/i.test(msg)) return 'Manage Channels';
  return null;
}

let didLogPreflight = false;

export async function runDiscordPreflightOnce(cfg: Config, client: Client): Promise<void> {
  if (didLogPreflight) return;
  didLogPreflight = true;

  if (!cfg.DISCORD_GUILD_ID) return;
  if (!client.user) return;

  let guild: Guild | null = null;
  try {
    guild = await client.guilds.fetch(cfg.DISCORD_GUILD_ID);
  } catch (e: any) {
    console.error('[oc-bridge] preflight: failed to fetch guild:', e?.message ?? e);
    return;
  }

  let me: GuildMember | null = null;
  try {
    me = await guild.members.fetch(client.user.id);
  } catch (e: any) {
    console.error('[oc-bridge] preflight: failed to fetch bot member:', e?.message ?? e);
    return;
  }

  const missing = getMissingGuildPermissions(me);
  const intentOk = hasMessageContentIntent(client);

  if (!intentOk) {
    console.error(
      '[oc-bridge] preflight: Message Content Intent is not enabled in runtime intents. Messages may not be forwarded. ' +
        'Enable it in code and in the Discord Dev Portal (Privileged Gateway Intents).',
    );
  }

  if (missing.length > 0) {
    console.error(
      '[oc-bridge] preflight: bot role may be missing permissions (guild-level; channel overrides may differ): ' +
        missing.join(', '),
    );
  }
}

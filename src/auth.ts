import type { Config } from './config.js';

function isAuthorized(
  cfg: Pick<Config, 'DISCORD_ALLOW_USER_IDS' | 'DISCORD_ALLOW_ROLE_IDS' | 'DISCORD_DEFAULT_DENY'>,
  userId: string,
  memberRoleIds?: string[],
): boolean {
  const allowUsers = cfg.DISCORD_ALLOW_USER_IDS ?? [];
  const allowRoles = cfg.DISCORD_ALLOW_ROLE_IDS ?? [];
  const defaultDeny = Boolean(cfg.DISCORD_DEFAULT_DENY);

  // Backwards compatible default-open unless DISCORD_DEFAULT_DENY=true.
  if (allowUsers.length === 0 && allowRoles.length === 0) return defaultDeny ? false : true;

  if (allowUsers.includes(userId)) return true;

  const roles = memberRoleIds ?? [];
  if (roles.length > 0 && allowRoles.length > 0) {
    for (const r of roles) {
      if (allowRoles.includes(r)) return true;
    }
  }

  return false;
}

export function isAuthorizedForOcSlash(cfg: Config, userId: string, memberRoleIds?: string[]): boolean {
  return isAuthorized(cfg, userId, memberRoleIds);
}

export function isAuthorizedForMessage(cfg: Config, userId: string, memberRoleIds?: string[]): boolean {
  return isAuthorized(cfg, userId, memberRoleIds);
}

export function extractRoleIdsFromInteractionMember(member: unknown): string[] {
  if (!member) return [];

  // discord.js types:
  // - GuildMember: member.roles is a RoleManager with .cache (Collection)
  // - APIInteractionGuildMember: member.roles is string[]
  const roles: any = (member as any).roles;
  if (!roles) return [];

  // APIInteractionGuildMember
  if (Array.isArray(roles)) return roles.filter((x) => typeof x === 'string');

  // GuildMember
  const cache = roles.cache;
  if (cache && typeof cache.map === 'function') {
    return cache.map((r: any) => r?.id).filter((x: any) => typeof x === 'string');
  }

  return [];
}

export function extractRoleIdsFromMessageMember(member: unknown): string[] {
  // message.member is usually a GuildMember (RoleManager w/ cache)
  return extractRoleIdsFromInteractionMember(member);
}

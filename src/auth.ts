import type { Config } from './config.js';

export function isAuthorizedForOcSlash(cfg: Config, userId: string, memberRoleIds?: string[]): boolean {
  const allowUsers = cfg.DISCORD_ALLOW_USER_IDS ?? [];
  const allowRoles = cfg.DISCORD_ALLOW_ROLE_IDS ?? [];

  // Default-open for backwards compatibility unless explicitly configured.
  if (allowUsers.length === 0 && allowRoles.length === 0) return true;

  if (allowUsers.includes(userId)) return true;

  const roles = memberRoleIds ?? [];
  if (roles.length > 0 && allowRoles.length > 0) {
    for (const r of roles) {
      if (allowRoles.includes(r)) return true;
    }
  }

  return false;
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

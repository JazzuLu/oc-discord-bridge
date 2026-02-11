import test from 'node:test';
import assert from 'node:assert/strict';

import { extractRoleIdsFromInteractionMember, isAuthorizedForOcSlash } from '../dist/auth.js';

test('isAuthorizedForOcSlash: default-open when both allowlists empty (backwards compatible)', () => {
  const cfg = { DISCORD_ALLOW_USER_IDS: [], DISCORD_ALLOW_ROLE_IDS: [] };
  assert.equal(isAuthorizedForOcSlash(cfg, 'u1', []), true);
  assert.equal(isAuthorizedForOcSlash(cfg, 'u2', ['r1']), true);
});

test('isAuthorizedForOcSlash: allow by explicit user id allowlist', () => {
  const cfg = { DISCORD_ALLOW_USER_IDS: ['u1'], DISCORD_ALLOW_ROLE_IDS: [] };
  assert.equal(isAuthorizedForOcSlash(cfg, 'u1', []), true);
  assert.equal(isAuthorizedForOcSlash(cfg, 'u2', []), false);
});

test('isAuthorizedForOcSlash: allow by role allowlist', () => {
  const cfg = { DISCORD_ALLOW_USER_IDS: [], DISCORD_ALLOW_ROLE_IDS: ['r2'] };
  assert.equal(isAuthorizedForOcSlash(cfg, 'u1', ['r1', 'r2']), true);
  assert.equal(isAuthorizedForOcSlash(cfg, 'u1', ['r1']), false);
});

test('extractRoleIdsFromInteractionMember: supports APIInteractionGuildMember.roles string[]', () => {
  const member = { roles: ['r1', 'r2', 123, null] };
  assert.deepEqual(extractRoleIdsFromInteractionMember(member), ['r1', 'r2']);
});

test('extractRoleIdsFromInteractionMember: supports discord.js GuildMember.roles.cache.map()', () => {
  const member = {
    roles: {
      cache: {
        map(fn) {
          return [{ id: 'r1' }, { id: 'r2' }, { id: 123 }].map(fn);
        },
      },
    },
  };
  assert.deepEqual(extractRoleIdsFromInteractionMember(member), ['r1', 'r2']);
});

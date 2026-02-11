import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DISCORD_NO_MENTIONS, withNoMentions } from '../dist/discordMentions.js';

test('DISCORD_NO_MENTIONS: disables all mention parsing', () => {
  assert.deepEqual(DISCORD_NO_MENTIONS, {
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    },
  });
});

test('withNoMentions: merges allowedMentions into options (without mutating input)', () => {
  const opts = { content: 'hi', ephemeral: true };
  const merged = withNoMentions(opts);

  assert.equal(merged.content, 'hi');
  assert.equal(merged.ephemeral, true);
  assert.deepEqual(merged.allowedMentions, DISCORD_NO_MENTIONS.allowedMentions);

  // original not mutated
  assert.equal(Object.prototype.hasOwnProperty.call(opts, 'allowedMentions'), false);
});

test('regression: index.ts applies allowedMentions disabling to Discord output paths', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const indexTs = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8');

  // Ensure the entrypoint imports the helper and uses it.
  assert.match(indexTs, /from '\.\/discordMentions\.js'/);
  assert.match(indexTs, /withNoMentions\(/);

  const mentionsTs = fs.readFileSync(path.join(root, 'src', 'discordMentions.ts'), 'utf8');

  // Core security guarantee.
  assert.match(mentionsTs, /allowedMentions[\s\S]*parse:\s*\[\s*\]/);
});

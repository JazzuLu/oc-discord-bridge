import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_ALLOWED_MENTIONS, withAllowedMentions } from '../dist/mentions.js';

test('withAllowedMentions: injects safe allowedMentions by default', () => {
  const cfg = { DISCORD_ALLOW_MENTIONS: false };
  const out = withAllowedMentions(cfg, { content: 'hi' });
  assert.deepEqual(out.allowedMentions, DEFAULT_ALLOWED_MENTIONS);
});

test('withAllowedMentions: preserves explicit allowedMentions override', () => {
  const cfg = { DISCORD_ALLOW_MENTIONS: false };
  const out = withAllowedMentions(cfg, { content: 'hi', allowedMentions: { parse: ['users'] } });
  assert.deepEqual(out.allowedMentions, { parse: ['users'] });
});

test('withAllowedMentions: no-op when DISCORD_ALLOW_MENTIONS=true', () => {
  const cfg = { DISCORD_ALLOW_MENTIONS: true };
  const inOpts = { content: 'hi' };
  const out = withAllowedMentions(cfg, inOpts);
  assert.equal(out, inOpts);
  assert.equal('allowedMentions' in out, false);
});

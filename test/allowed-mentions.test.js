import test from 'node:test';
import assert from 'node:assert/strict';

import { BRIDGE_ALLOWED_MENTIONS, bridgeMessageOptions } from '../dist/bridgeAllowedMentions.js';

test('bridgeMessageOptions: forces allowedMentions.parse=[]', () => {
  assert.deepEqual(BRIDGE_ALLOWED_MENTIONS, { parse: [] });

  const opts = bridgeMessageOptions({ content: 'hi @everyone <@123> <@&456>' });
  assert.equal(opts.content, 'hi @everyone <@123> <@&456>');
  assert.deepEqual(opts.allowedMentions, { parse: [] });
});

test('bridgeMessageOptions: overrides any caller-provided allowedMentions', () => {
  const opts = bridgeMessageOptions({ content: 'x', allowedMentions: { parse: ['users', 'roles', 'everyone'] } });
  assert.deepEqual(opts.allowedMentions, { parse: [] });
});

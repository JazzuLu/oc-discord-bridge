import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_MENTIONS_NONE,
  contentNoMentions,
  ixEditReplyNoMentions,
  ixReplyNoMentions,
  safeEdit,
  safeReply,
} from '../dist/discordMentions.js';

test('contentNoMentions: forces allowedMentions parse/users/roles empty', () => {
  const opts = contentNoMentions('hi', { ephemeral: true, allowedMentions: { parse: ['users'] } });
  assert.equal(opts.content, 'hi');
  assert.equal(opts.ephemeral, true);
  assert.deepEqual(opts.allowedMentions, ALLOWED_MENTIONS_NONE);
});

test('safeReply: calls reply() with allowedMentions disabled', async () => {
  const calls = [];
  const msg = {
    async reply(o) {
      calls.push(o);
      return { id: 'm1' };
    },
  };

  await safeReply(msg, '@everyone hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].content, '@everyone hello');
  assert.deepEqual(calls[0].allowedMentions, ALLOWED_MENTIONS_NONE);
});

test('safeEdit: calls edit() with allowedMentions disabled', async () => {
  const calls = [];
  const message = {
    async edit(o) {
      calls.push(o);
      return { id: 'm1' };
    },
  };

  await safeEdit(message, '<@123> hi');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].content, '<@123> hi');
  assert.deepEqual(calls[0].allowedMentions, ALLOWED_MENTIONS_NONE);
});

test('ixReplyNoMentions/ixEditReplyNoMentions: force allowedMentions disabled', () => {
  const r = ixReplyNoMentions({ content: 'x', ephemeral: true, allowedMentions: { parse: ['everyone'] } });
  assert.deepEqual(r.allowedMentions, ALLOWED_MENTIONS_NONE);

  const e = ixEditReplyNoMentions({ content: 'y', allowedMentions: { parse: ['roles'] } });
  assert.deepEqual(e.allowedMentions, ALLOWED_MENTIONS_NONE);
});

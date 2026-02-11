import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchExplicitTrigger } from '../dist/trigger.js';

test('explicit trigger: off forwards unchanged', () => {
  const r = matchExplicitTrigger({
    mode: 'off',
    prefix: '!oc ',
    content: 'hello',
    botUserId: '123',
    isBotMentioned: false,
  });
  assert.equal(r.matched, true);
  assert.equal(r.content, 'hello');
});

test('explicit trigger: prefix matches and strips', () => {
  const r = matchExplicitTrigger({
    mode: 'prefix',
    prefix: '!oc ',
    content: '!oc do the thing',
    botUserId: '123',
    isBotMentioned: false,
  });
  assert.equal(r.matched, true);
  assert.equal(r.content, 'do the thing');
});

test('explicit trigger: prefix does not match', () => {
  const r = matchExplicitTrigger({
    mode: 'prefix',
    prefix: '!oc ',
    content: 'do the thing',
    botUserId: '123',
    isBotMentioned: false,
  });
  assert.deepEqual(r, { matched: false });
});

test('explicit trigger: mention matches (and strips if leading mention)', () => {
  const r = matchExplicitTrigger({
    mode: 'mention',
    prefix: '!oc ',
    content: '<@123>   hello',
    botUserId: '123',
    isBotMentioned: true,
  });
  assert.equal(r.matched, true);
  assert.equal(r.content, 'hello');
});

test('explicit trigger: mention_or_prefix matches either', () => {
  const a = matchExplicitTrigger({
    mode: 'mention_or_prefix',
    prefix: '!oc ',
    content: '!oc ping',
    botUserId: '123',
    isBotMentioned: false,
  });
  assert.equal(a.matched, true);
  assert.equal(a.content, 'ping');

  const b = matchExplicitTrigger({
    mode: 'mention_or_prefix',
    prefix: '!oc ',
    content: 'hi <@123>',
    botUserId: '123',
    isBotMentioned: true,
  });
  assert.equal(b.matched, true);
  // mention is not leading, so we keep content
  assert.equal(b.content, 'hi <@123>');
});

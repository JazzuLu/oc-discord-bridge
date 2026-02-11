import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPromptTextFromMessage, hasMeaningfulUserText } from '../dist/messageFilter.js';

function fakeCollection(items) {
  return {
    values() {
      return items[Symbol.iterator]();
    },
  };
}

test('hasMeaningfulUserText: accepts non-empty trimmed content', () => {
  assert.equal(hasMeaningfulUserText({ content: 'hi', system: false, author: { bot: false }, webhookId: null }), true);
  assert.equal(hasMeaningfulUserText({ content: '  hi  ', system: false, author: { bot: false }, webhookId: null }), true);
});

test('hasMeaningfulUserText: rejects empty/whitespace-only content', () => {
  assert.equal(hasMeaningfulUserText({ content: '', system: false, author: { bot: false }, webhookId: null }), false);
  assert.equal(hasMeaningfulUserText({ content: '   ', system: false, author: { bot: false }, webhookId: null }), false);
  assert.equal(hasMeaningfulUserText({ content: null, system: false, author: { bot: false }, webhookId: null }), false);
});

test('hasMeaningfulUserText: rejects system and webhook messages even if they have content', () => {
  assert.equal(hasMeaningfulUserText({ content: 'hello', system: true, author: { bot: false }, webhookId: null }), false);
  assert.equal(hasMeaningfulUserText({ content: 'hello', system: false, author: { bot: false }, webhookId: 'wh_1' }), false);
});

test('buildPromptTextFromMessage: returns empty when content is empty (ignores attachment-only)', () => {
  const msg = {
    content: '   ',
    attachments: fakeCollection([{ name: 'a.png', url: 'https://example.com/a.png', size: 123, contentType: 'image/png' }]),
  };
  assert.equal(buildPromptTextFromMessage(msg), '');
});

test('buildPromptTextFromMessage: includes attachments when content is present', () => {
  const msg = {
    content: 'see this',
    attachments: fakeCollection([
      { name: 'a.png', url: 'https://example.com/a.png', size: 2048, contentType: 'image/png' },
    ]),
  };
  const out = buildPromptTextFromMessage(msg);
  assert.ok(out.startsWith('see this'));
  assert.ok(out.includes('[Attachments]'));
  assert.ok(out.includes('a.png'));
  assert.ok(out.includes('https://example.com/a.png'));
});

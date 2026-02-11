import test from 'node:test';
import assert from 'node:assert/strict';

import { streamToDiscord } from '../dist/streamToDiscord.js';

class FakePlaceholder {
  edits = [];
  async edit(t) {
    this.edits.push(t);
    return this;
  }
}

class FakeMsg {
  replies = [];
  placeholder;

  async reply(t) {
    this.replies.push(t);
    if (t === '…' && !this.placeholder) {
      this.placeholder = new FakePlaceholder();
      return this.placeholder;
    }
    return { edit: async () => {} };
  }
}

test('streamToDiscord: does not duplicate continuation replies when flushing multiple times over 2000 chars', async () => {
  const msg = new FakeMsg();

  const emitPieces = async (emit) => {
    emit('a'.repeat(2500));
    emit('b'.repeat(2000));
  };

  await streamToDiscord(msg, emitPieces, {
    withDiscordRetry: async (fn) => fn(),
    maxLen: 2000,
    // Make flush run immediately and without throttling for a fast deterministic test.
    scheduleDelayMs: 0,
    editThrottleMs: 0,
    nowFn: () => 0,
    setTimeoutFn: (fn) => {
      fn();
      return /** @type {any} */ (null);
    },
    clearTimeoutFn: () => {},
  });

  // reply('…') + one continuation for the first 2500 (tail=500) + one continuation for new tail (2000)
  assert.equal(msg.replies.length, 3);
  assert.equal(msg.replies[0], '…');
  assert.equal(msg.replies[1].length, 500);
  assert.equal(msg.replies[2].length, 2000);

  assert.ok(msg.placeholder);
  // Placeholder should be edited to the head (2000). It may be edited multiple times.
  assert.equal(msg.placeholder.edits.at(-1).length, 2000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { streamToDiscord } from '../dist/discord.js';

test('streamToDiscord: edits placeholder with safe error (includes corr) when onChunk throws', async () => {
  const replies = [];
  const edits = [];

  const placeholder = {
    edit: async (t) => {
      edits.push(t);
    },
  };

  const msg = {
    reply: async (t) => {
      replies.push(t);
      return placeholder;
    },
  };

  await assert.rejects(
    () =>
      streamToDiscord(
        msg,
        async (emit) => {
          emit('partial');
          throw new Error('boom: secrets=123');
        },
        { corr: 'abc12345' },
      ),
    /boom/, // the internal error still propagates upstream
  );

  assert.equal(replies[0], '…');
  assert.ok(edits.length >= 1, 'placeholder should be edited on failure');
  const last = edits.at(-1);
  assert.ok(last.includes('corr=abc12345'));
  assert.ok(!last.includes('boom'), 'user-facing error must not include exception details');
  assert.ok(!last.includes('secrets=123'), 'user-facing error must not leak exception payloads');
});

test('streamToDiscord: streams and flushes final text', async () => {
  const edits = [];
  const placeholder = {
    edit: async (t) => {
      edits.push(t);
    },
  };

  const msg = {
    reply: async () => placeholder,
  };

  await streamToDiscord(msg, async (emit) => {
    emit('hello');
    emit(' world');
  });

  assert.equal(edits.at(-1), 'hello world');
});

test('streamToDiscord: splits >2000 chars into continuation replies', async () => {
  const replies = [];
  const edits = [];
  const placeholder = {
    edit: async (t) => {
      edits.push(t);
    },
  };

  const msg = {
    reply: async (t) => {
      replies.push(t);
      return placeholder;
    },
  };

  const s = 'a'.repeat(4500);
  await streamToDiscord(msg, async (emit) => {
    emit(s);
  });

  // First reply is placeholder.
  assert.equal(replies[0], '…');
  // Placeholder edited to head(2000).
  assert.equal(edits[0].length, 2000);

  // Continuations: remaining 2500 => 2 replies (2000 + 500)
  const continuations = replies.slice(1);
  assert.equal(continuations.length, 2);
  assert.equal(continuations[0].length, 2000);
  assert.equal(continuations[1].length, 500);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { ThreadQueue } from '../dist/threadQueue.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('ThreadQueue: preserves FIFO ordering per thread', async () => {
  const q = new ThreadQueue();
  const seen = [];

  await Promise.all([
    q.enqueue('t1', async () => {
      await sleep(30);
      seen.push('a');
    }),
    q.enqueue('t1', async () => {
      seen.push('b');
    }),
    q.enqueue('t1', async () => {
      seen.push('c');
    }),
  ]);

  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('ThreadQueue: allows concurrency across threads', async () => {
  const q = new ThreadQueue();

  let aStarted = false;
  let bStarted = false;

  const a = q.enqueue('tA', async () => {
    aStarted = true;
    // keep task alive long enough to overlap
    await sleep(50);
  });

  // Wait a tick so tA definitely starts.
  await sleep(5);

  const b = q.enqueue('tB', async () => {
    bStarted = true;
  });

  await Promise.all([a, b]);

  assert.equal(aStarted, true);
  assert.equal(bStarted, true);
});

test('ThreadQueue: depth increments while tasks are pending and drains to zero', async () => {
  const q = new ThreadQueue();

  const blocker = new Promise((r) => setTimeout(r, 30));
  const p1 = q.enqueue('t1', async () => {
    await blocker;
  });
  const p2 = q.enqueue('t1', async () => {});

  assert.equal(q.depth('t1'), 2);

  await Promise.all([p1, p2]);
  assert.equal(q.depth('t1'), 0);
});

test('ThreadQueue: tryEnqueue enforces maxDepth atomically', async () => {
  const q = new ThreadQueue();

  let release;
  const gate = new Promise((r) => {
    release = r;
  });

  const first = q.tryEnqueue('t1', 1, async () => {
    await gate;
  });
  assert.ok(first, 'first task should be accepted');
  assert.equal(q.depth('t1'), 1);

  const second = q.tryEnqueue('t1', 1, async () => {
    throw new Error('should not run');
  });
  assert.equal(second, null);
  assert.equal(q.depth('t1'), 1);

  release();
  await first;
  assert.equal(q.depth('t1'), 0);
});

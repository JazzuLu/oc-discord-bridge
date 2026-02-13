import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueThreadWork, resetThreadQueues, DEFAULT_THREAD_QUEUE_LIMIT } from '../dist/threadQueue.js';

test('threadQueue: runs work sequentially for same thread', async () => {
  resetThreadQueues();
  const threadId = 't1';
  const executionOrder = [];

  const work1 = async () => {
    await new Promise((r) => setTimeout(r, 50));
    executionOrder.push(1);
  };
  const work2 = async () => {
    executionOrder.push(2);
  };

  const p1 = enqueueThreadWork(threadId, work1);
  const p2 = enqueueThreadWork(threadId, work2);

  assert.ok(p1);
  assert.ok(p2);

  await Promise.all([p1, p2]);
  assert.deepEqual(executionOrder, [1, 2]);
});

test('threadQueue: runs work in parallel for different threads', async () => {
  resetThreadQueues();
  const thread1 = 't1';
  const thread2 = 't2';
  const executionOrder = [];

  // t1 takes long
  const work1 = async () => {
    await new Promise((r) => setTimeout(r, 50));
    executionOrder.push('t1');
  };
  // t2 is instant
  const work2 = async () => {
    executionOrder.push('t2');
  };

  const p1 = enqueueThreadWork(thread1, work1);
  const p2 = enqueueThreadWork(thread2, work2);

  await Promise.all([p1, p2]);
  // t2 should likely finish before t1 if parallel
  // In pure parallel execution, t2 finishes first.
  assert.deepEqual(executionOrder, ['t2', 't1']);
});

test('threadQueue: rejects work when limit exceeded', async () => {
  resetThreadQueues();
  const threadId = 't_limit';
  
  // Use a custom limit of 2 for testing
  const limit = 2;

  // Fill the queue. Current running + 1 pending = 2.
  // We need a blocking job to hold the queue open.
  let release;
  const blocker = new Promise((r) => { release = r; });
  
  const workBlock = () => blocker;

  // 1. First job (running). Pending becomes 1.
  const p1 = enqueueThreadWork(threadId, workBlock, { limit });
  assert.ok(p1, 'p1 should be accepted');

  // 2. Second job (pending 1 -> 2). Limit 2 reached?
  // Logic: if (state.pending >= limit) return null.
  // pending increments AFTER check.
  // So:
  // p1: pending=0. check(0>=2) no. pending=1.
  // p2: pending=1. check(1>=2) no. pending=2.
  // p3: pending=2. check(2>=2) YES. REJECT.
  
  const p2 = enqueueThreadWork(threadId, workBlock, { limit });
  assert.ok(p2, 'p2 should be accepted');

  const p3 = enqueueThreadWork(threadId, async () => {}, { limit });
  assert.strictEqual(p3, null, 'p3 should be rejected because pending(2) >= limit(2)');

  // Release the blocker
  release();
  await Promise.all([p1, p2]);
});

test('threadQueue: handles errors gracefully', async () => {
  resetThreadQueues();
  const threadId = 't_error';
  const results = [];

  const workError = async () => {
    throw new Error('boom');
  };
  const workSuccess = async () => {
    results.push('success');
  };

  // p1 fails
  const p1 = enqueueThreadWork(threadId, workError);
  // p2 should still run
  const p2 = enqueueThreadWork(threadId, workSuccess);

  await assert.rejects(p1, /boom/);
  await p2;

  assert.deepEqual(results, ['success']);
});

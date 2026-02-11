import test from 'node:test';
import assert from 'node:assert/strict';

import { setChannelTopicSafely } from '../dist/topicUpdater.js';

const flushNextTick = () => new Promise((resolve) => setImmediate(resolve));

function createFakeChannel(topic) {
  const ch = {
    id: 'channel-1',
    topic,
    async fetch() {
      return ch;
    },
    async setTopic(newTopic) {
      ch.topic = newTopic;
      return ch;
    },
  };
  return ch;
}

test('no-op fast path skips topic update when topic already matches target', async () => {
  const channel = createFakeChannel('foo\nCWD=/repo');
  let called = false;
  channel.setTopic = async (topic) => {
    called = true;
    channel.topic = topic;
    return channel;
  };

  const result = await setChannelTopicSafely(channel, '/repo');
  assert.equal(result.status, 'skipped');
  assert.equal(called, false);
});

test('per-channel queue serializes concurrent topic updates', async () => {
  const channel = createFakeChannel('initial');
  const order = [];
  let releaseFirst;
  const waitFirst = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let callCount = 0;
  channel.setTopic = async (topic) => {
    callCount += 1;
    order.push(`call-${callCount}`);
    channel.topic = topic;
    if (callCount === 1) {
      await waitFirst;
    }
    return channel;
  };

  const pendingA = setChannelTopicSafely(channel, '/first');
  const pendingB = setChannelTopicSafely(channel, '/second');

  await flushNextTick();
  assert.deepEqual(order, ['call-1'], 'Second update should wait until first finishes');

  releaseFirst();
  await Promise.all([pendingA, pendingB]);
  assert.deepEqual(order, ['call-1', 'call-2']);
});

test('retries on 429 with Retry-After before succeeding', async () => {
  const channel = createFakeChannel('base');
  let tryCount = 0;
  channel.setTopic = async (topic) => {
    tryCount += 1;
    channel.topic = topic;
    if (tryCount === 1) {
      const err = { status: 429, rawError: { retry_after: 0 } };
      throw err;
    }
    return channel;
  };

  const result = await setChannelTopicSafely(channel, '/repo');
  assert.equal(result.status, 'updated');
  assert.equal(result.attempts, 2);
});

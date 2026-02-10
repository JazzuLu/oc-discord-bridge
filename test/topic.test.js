import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTopicWithCwd, isMainThreadName, parseCwdFromTopic, TOPIC_MAX } from '../dist/topic.js';

test('parseCwdFromTopic: extracts CWD line (trim + first match)', () => {
  assert.equal(parseCwdFromTopic(null), null);
  assert.equal(parseCwdFromTopic('hello'), null);
  assert.equal(parseCwdFromTopic('CWD=/tmp'), '/tmp');
  assert.equal(parseCwdFromTopic('  CWD=/a/b  '), '/a/b');
  assert.equal(parseCwdFromTopic('x\nCWD=/x\ny'), '/x');
  assert.equal(parseCwdFromTopic('CWD=\nnext'), null);
});

test('buildTopicWithCwd: appends CWD and removes duplicate CWD lines', () => {
  const t1 = buildTopicWithCwd('foo', '/repo');
  assert.ok(t1.includes('foo'));
  assert.ok(t1.endsWith('CWD=/repo'));

  const t2 = buildTopicWithCwd('CWD=/old\nfoo\nCWD=/older', '/new');
  assert.ok(!t2.includes('CWD=/old'));
  assert.ok(!t2.includes('CWD=/older'));
  assert.ok(t2.includes('foo'));
  assert.ok(t2.endsWith('CWD=/new'));
});

test('buildTopicWithCwd: respects TOPIC_MAX and keeps the CWD line', () => {
  const long = Array.from({ length: 200 }, (_, i) => `line-${i}-${'x'.repeat(20)}`).join('\n');
  const t = buildTopicWithCwd(long, '/repo');
  assert.ok(t.length <= TOPIC_MAX);
  assert.ok(t.includes('CWD=/repo'));
  assert.ok(t.endsWith('CWD=/repo'));
});

test('isMainThreadName: tolerant matching', () => {
  assert.equal(isMainThreadName('main'), true);
  assert.equal(isMainThreadName('Main'), true);
  assert.equal(isMainThreadName(' main '), true);
  assert.equal(isMainThreadName('main something'), true);
  assert.equal(isMainThreadName('main-something'), true);
  assert.equal(isMainThreadName('main:something'), true);

  assert.equal(isMainThreadName('not-main'), false);
  assert.equal(isMainThreadName('maintain'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

import { redactForLogs } from '../dist/redact.js';

test('redactForLogs: replaces home dir with ~', () => {
  const home = os.homedir();
  const s = `failed to read ${home}/secret/file.txt`;
  const out = redactForLogs(s);
  assert.ok(out.includes('~/secret/file.txt'));
  assert.ok(!out.includes(home));
});

test('redactForLogs: redacts known tokens (OpenAI/GitHub/Bearer)', () => {
  assert.ok(!redactForLogs('sk-abcdefghijklmnopqrstuvwxyz0123456789').includes('abcdefghijklmnopqrstuvwxyz'));
  assert.equal(redactForLogs('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789'), 'Authorization: Bearer ***REDACTED***');
  assert.equal(redactForLogs('token=abcdefghijklmnopqrstuvwxyz0123456789'), 'token=***REDACTED***');
});

test('redactForLogs: shortens very long absolute paths', () => {
  const long = `/var/folders/xx/yy/zz/${'a'.repeat(80)}/file.log`;
  const out = redactForLogs(`oops ${long}`);
  assert.ok(out.includes('/…/file.log'));
});

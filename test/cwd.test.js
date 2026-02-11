import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateChannelCwd } from '../dist/cwd.js';

test('validateChannelCwd: rejects relative paths', async () => {
  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, 'relative/path');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_absolute');
});

test('validateChannelCwd: rejects newline-containing values', async () => {
  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, '/tmp\n/evil');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'contains_newline');
});

test('validateChannelCwd: rejects non-existent paths', async () => {
  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, path.join(os.tmpdir(), `nope-${Date.now()}-${Math.random()}`));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
});

test('validateChannelCwd: accepts any existing absolute dir when prefixes unset', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-cwd-'));
  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, tmp);
  assert.deepEqual(r, { ok: true, cwd: path.resolve(tmp) });
});

test('validateChannelCwd: normalizes paths (resolves .. segments)', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-cwd-'));
  const child = path.join(base, 'child');
  await fs.mkdir(child);

  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, path.join(child, '..'));
  assert.deepEqual(r, { ok: true, cwd: path.resolve(base) });
});

test('validateChannelCwd: rejects newline-containing values', async () => {
  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, `/tmp\n/evil`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'contains_newline');
});

test('validateChannelCwd: trims + normalizes with path.resolve', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-cwd-'));
  const child = path.join(base, 'child');
  await fs.mkdir(child);

  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const input = `  ${path.join(child, '..')}  `;
  const r = await validateChannelCwd(cfg, input);

  assert.deepEqual(r, { ok: true, cwd: base });
});

test('validateChannelCwd: enforces allowed prefixes when configured', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-cwd-'));
  const allowed = path.join(base, 'allowed');
  const denied = path.join(base, 'denied');
  await fs.mkdir(allowed);
  await fs.mkdir(denied);

  const cfg = { DISCORD_ALLOWED_CWD_PREFIXES: [allowed] };

  const ok = await validateChannelCwd(cfg, allowed);
  assert.equal(ok.ok, true);

  const bad = await validateChannelCwd(cfg, denied);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not_allowed');
});

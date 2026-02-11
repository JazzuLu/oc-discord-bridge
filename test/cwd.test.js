import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateChannelCwd } from '../dist/cwd.js';

test('validateChannelCwd: rejects relative paths', async () => {
  const cfg = { DISCORD_CWD_ALLOW_ROOTS: [], DISCORD_CWD_REQUIRE_EXISTS: true, DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, 'relative/path');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_absolute');
});

test('validateChannelCwd: rejects non-existent paths', async () => {
  const cfg = { DISCORD_CWD_ALLOW_ROOTS: [], DISCORD_CWD_REQUIRE_EXISTS: true, DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, path.join(os.tmpdir(), `nope-${Date.now()}-${Math.random()}`));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
});

test('validateChannelCwd: accepts any existing absolute dir when roots unset', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-cwd-'));
  const cfg = { DISCORD_CWD_ALLOW_ROOTS: [], DISCORD_CWD_REQUIRE_EXISTS: true, DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, tmp);
  assert.deepEqual(r, { ok: true, cwd: tmp });
});

test('validateChannelCwd: enforces allowed roots when configured', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-cwd-'));
  const allowed = path.join(base, 'allowed');
  const denied = path.join(base, 'denied');
  await fs.mkdir(allowed);
  await fs.mkdir(denied);

  const cfg = { DISCORD_CWD_ALLOW_ROOTS: [allowed], DISCORD_CWD_REQUIRE_EXISTS: true, DISCORD_ALLOWED_CWD_PREFIXES: [] };

  const ok = await validateChannelCwd(cfg, allowed);
  assert.equal(ok.ok, true);

  const bad = await validateChannelCwd(cfg, denied);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not_allowed');
});

test('validateChannelCwd: rejects NUL/newlines', async () => {
  const cfg = { DISCORD_CWD_ALLOW_ROOTS: [], DISCORD_CWD_REQUIRE_EXISTS: true, DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, `/tmp/ok\nnope`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid_chars');
});

test('validateChannelCwd: uses realpath to prevent symlink escape', async () => {
  // allowedRoot/inside is a symlink to outsideRoot
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-cwd-'));
  const allowedRoot = path.join(base, 'allowedRoot');
  const outsideRoot = path.join(base, 'outsideRoot');
  await fs.mkdir(allowedRoot);
  await fs.mkdir(outsideRoot);

  const outsideDir = path.join(outsideRoot, 'real');
  await fs.mkdir(outsideDir);

  const link = path.join(allowedRoot, 'inside');
  await fs.symlink(outsideDir, link);

  const cfg = { DISCORD_CWD_ALLOW_ROOTS: [allowedRoot], DISCORD_CWD_REQUIRE_EXISTS: true, DISCORD_ALLOWED_CWD_PREFIXES: [] };
  const r = await validateChannelCwd(cfg, link);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_allowed');
});

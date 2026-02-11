import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

import { JsonStore } from '../dist/storage.js';

test('JsonStore.updateJson: serializes concurrent updates per file (no lost updates)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocdb-store-'));
  const store = new JsonStore(dir);

  const N = 50;
  await Promise.all(
    Array.from({ length: N }, () =>
      store.updateJson('counter.json', { n: 0 }, (cur) => ({ n: (cur?.n ?? 0) + 1 })),
    ),
  );

  const v = await store.readJson('counter.json', { n: 0 });
  assert.equal(v.n, N);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConfigSchema } from '../dist/config.js';

function keysFromEnvExample(s) {
  const out = [];
  for (const line of s.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^([A-Z0-9_]+)=/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

test('.env.example keys match ConfigSchema keys', () => {
  const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const envKeys = keysFromEnvExample(envExample);
  const schemaKeys = Object.keys(ConfigSchema.shape);

  const missingInEnv = schemaKeys.filter((k) => !envKeys.includes(k));
  const extraInEnv = envKeys.filter((k) => !schemaKeys.includes(k));

  assert.deepEqual(missingInEnv, [], `Missing in .env.example: ${missingInEnv.join(', ')}`);
  assert.deepEqual(extraInEnv, [], `Extra in .env.example: ${extraInEnv.join(', ')}`);
});

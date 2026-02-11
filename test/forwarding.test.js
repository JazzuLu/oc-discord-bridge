import test from 'node:test';
import assert from 'node:assert/strict';

import { decideForwardContent } from '../dist/forwarding.js';

test('forwarding:auto forwards content unchanged', () => {
  const r = decideForwardContent({ mode: 'auto', prefix: 'oc:', content: 'hello', mentionsBot: false });
  assert.deepEqual(r, { ok: true, content: 'hello' });
});

test('forwarding:mention requires a bot mention', () => {
  const no = decideForwardContent({ mode: 'mention', prefix: 'oc:', content: 'hello', mentionsBot: false });
  assert.equal(no.ok, false);
  assert.equal(no.reason, 'not_mentioned');

  const yes = decideForwardContent({ mode: 'mention', prefix: 'oc:', content: 'hi <@bot>', mentionsBot: true });
  assert.deepEqual(yes, { ok: true, content: 'hi <@bot>' });
});

test('forwarding:prefix requires prefix at start (ignoring leading whitespace) and strips it', () => {
  const no = decideForwardContent({ mode: 'prefix', prefix: 'oc:', content: 'hello', mentionsBot: false });
  assert.equal(no.ok, false);
  assert.equal(no.reason, 'missing_prefix');

  const yes1 = decideForwardContent({ mode: 'prefix', prefix: 'oc:', content: 'oc:hello', mentionsBot: false });
  assert.deepEqual(yes1, { ok: true, content: 'hello' });

  const yes2 = decideForwardContent({ mode: 'prefix', prefix: 'oc:', content: '  oc: hello', mentionsBot: false });
  assert.deepEqual(yes2, { ok: true, content: 'hello' });

  const yes3 = decideForwardContent({ mode: 'prefix', prefix: 'oc:', content: 'oc:', mentionsBot: false });
  assert.deepEqual(yes3, { ok: true, content: '' });
});

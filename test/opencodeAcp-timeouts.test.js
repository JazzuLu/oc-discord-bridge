import test from 'node:test';
import assert from 'node:assert/strict';

import { OpenCodeAcpClient, AcpRequestTimeoutError } from '../dist/opencodeAcp.js';

test('OpenCodeAcpClient: request timeout rejects with structured AcpRequestTimeoutError + clears pending', async () => {
  const oc = new OpenCodeAcpClient('opencode', process.cwd(), () => {}, { requestTimeoutMs: 5 });

  // Avoid triggering watchdog restarts/kill timers in this unit test.
  oc.watchdog = false;

  // Provide a minimal fake proc; send() only needs stdin.write for this test.
  oc.proc = {
    stdin: {
      write: () => true,
    },
  };

  const started = Date.now();
  await assert.rejects(
    () => oc.initialize(),
    (e) => {
      assert.ok(e instanceof AcpRequestTimeoutError);
      assert.equal(e.code, 'ACP_REQUEST_TIMEOUT');
      assert.equal(e.method, 'initialize');
      assert.equal(typeof e.id, 'number');
      assert.equal(e.timeoutMs, 5);
      return true;
    },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 5, `expected elapsed >= 5ms, got ${elapsed}ms`);

  assert.equal(oc.pending.size, 0);
});

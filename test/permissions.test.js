import test from 'node:test';
import assert from 'node:assert/strict';

import { hintMissingPermissionForSetTopic } from '../dist/permissions.js';

test('hintMissingPermissionForSetTopic: returns Manage Channels for Missing Permissions (50013)', () => {
  assert.equal(hintMissingPermissionForSetTopic({ code: 50013, message: 'Missing Permissions' }), 'Manage Channels');
  assert.equal(hintMissingPermissionForSetTopic({ code: '50013' }), 'Manage Channels');
});

test('hintMissingPermissionForSetTopic: returns null for unrelated errors', () => {
  assert.equal(hintMissingPermissionForSetTopic({ code: 123, message: 'nope' }), null);
  assert.equal(hintMissingPermissionForSetTopic(null), null);
});

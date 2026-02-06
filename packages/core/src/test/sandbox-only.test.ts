import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy, evaluateToolCall } from '../policy.js';

test('evaluateToolCall returns sandbox_only when tool matches sandbox_only patterns', () => {
  const policy = defaultPolicy();
  policy.tool = policy.tool ?? {};
  policy.tool.sandbox_only = ['system_*'];
  policy.tool.elevated_requires_approval = true;

  const decision = evaluateToolCall({ tool_name: 'system_write_file', args: { path: '/tmp/x', content: 'hi' } }, policy);
  assert.equal(decision.action, 'sandbox_only');
  assert.ok(decision.reasons.some((r) => r.reason_code === 'sandbox_only'));
});

test('evaluateToolCall deny takes precedence over sandbox_only', () => {
  const policy = defaultPolicy();
  policy.tool = policy.tool ?? {};
  policy.tool.sandbox_only = ['system_*'];
  policy.tool.elevated_requires_approval = true;

  const decision = evaluateToolCall({ tool_name: 'system_read_file', args: { path: '/Users/me/.ssh/id_rsa' } }, policy);
  assert.equal(decision.action, 'deny');
  assert.ok(decision.reasons.some((r) => r.reason_code === 'path_denied'));
});


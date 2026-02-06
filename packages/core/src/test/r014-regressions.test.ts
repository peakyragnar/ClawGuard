import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSkillBundle } from '../scan.js';
import type { SkillBundle } from '../types.js';

test('R014 does not flag public key authorized_keys install', () => {
  const bundle: SkillBundle = {
    id: 'ssh-pubkey',
    entrypoint: 'SKILL.md',
    files: [
      {
        path: 'SKILL.md',
        content_text: 'cat ~/.ssh/mykey_ed25519.pub | ssh user@host "cat >> ~/.ssh/authorized_keys"',
      },
    ],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(!report.findings.some((f) => f.rule_id === 'R014'));
});

test('R014 flags reading private key', () => {
  const bundle: SkillBundle = {
    id: 'ssh-private',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'cat ~/.ssh/id_ed25519' }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R014'));
});

test('R014 does not flag env example setup copy', () => {
  const bundle: SkillBundle = {
    id: 'env-example',
    entrypoint: 'README.md',
    files: [{ path: 'README.md', content_text: 'cp .env.example .env' }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(!report.findings.some((f) => f.rule_id === 'R014'));
});

test('R014 flags reading env', () => {
  const bundle: SkillBundle = {
    id: 'env-read',
    entrypoint: 'README.md',
    files: [{ path: 'README.md', content_text: 'cat .env' }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R014'));
});

test('R014 flags copying private key', () => {
  const bundle: SkillBundle = {
    id: 'ssh-private-cp',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'cp ~/.ssh/id_ed25519 /tmp/key' }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R014'));
});

test('R014 does not flag copying public key', () => {
  const bundle: SkillBundle = {
    id: 'ssh-pubkey-cp',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'cp ~/.ssh/id_ed25519.pub /tmp/key.pub' }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(!report.findings.some((f) => f.rule_id === 'R014'));
});

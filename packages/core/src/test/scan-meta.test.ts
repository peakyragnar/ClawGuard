import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSkillBundle } from '../scan.js';
import type { SkillBundle } from '../types.js';

test('scanSkillBundle flags manifest binary file (R009)', () => {
  const bundle: SkillBundle = {
    id: 'meta-binary',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'ok' }],
    manifest: [{ path: 'bin/payload.dylib', is_binary: true }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R009'));
});

test('scanSkillBundle flags manifest executable file (R008)', () => {
  const bundle: SkillBundle = {
    id: 'meta-exec',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'ok' }],
    manifest: [{ path: 'scripts/run.sh', is_executable: true }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R008'));
});

test('scanSkillBundle flags manifest symlink (R010)', () => {
  const bundle: SkillBundle = {
    id: 'meta-symlink',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'ok' }],
    manifest: [{ path: 'SKILL.md', is_symlink: true }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R010'));
});

test('scanSkillBundle flags zip invalid path (R012)', () => {
  const bundle: SkillBundle = {
    id: 'meta-traversal',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'ok' }],
    manifest: [{ path: '../SKILL.md', skipped_reason: 'invalid_path', raw_path: '../SKILL.md', source_kind: 'zip' }],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R012'));
});

test('scanSkillBundle flags ingest warnings (R013)', () => {
  const bundle: SkillBundle = {
    id: 'meta-warning',
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: 'ok' }],
    ingest_warnings: ['maxFiles reached (200)'],
  };
  const report = scanSkillBundle(bundle);
  assert.ok(report.findings.some((f) => f.rule_id === 'R013'));
});


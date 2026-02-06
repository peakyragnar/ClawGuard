import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanSkillBundle } from '../scan.js';
import type { SkillBundle } from '../types.js';

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function readDirRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await readDirRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function buildFixtureBundle(relativeDir: string): Promise<SkillBundle> {
  const repoRoot = resolve(process.cwd(), '../..');
  const fixtureDir = join(repoRoot, 'fixtures', 'skills', 'bad', relativeDir);
  assert.ok(existsSync(fixtureDir), `missing fixture dir: ${fixtureDir}`);

  const files: SkillBundle['files'] = [];
  const paths = await readDirRecursive(fixtureDir);
  for (const path of paths) {
    const content = await readTextFile(path);
    if (content === null) continue;
    files.push({
      path: path.replace(`${fixtureDir}/`, ''),
      content_text: content,
    });
  }
  return {
    id: `fixture:${relativeDir}`,
    source: 'local',
    entrypoint: existsSync(join(fixtureDir, 'SKILL.md')) ? 'SKILL.md' : relativeDir,
    files,
  };
}

type FixtureExpectation = {
  dir: string;
  ruleId: string;
  minScore: number;
};

const FIXTURES: FixtureExpectation[] = [
  { dir: 'curl', ruleId: 'R001', minScore: 80 },
  { dir: 'wget', ruleId: 'R002', minScore: 80 },
  { dir: 'powershell', ruleId: 'R003', minScore: 80 },
  { dir: 'base64', ruleId: 'R004', minScore: 60 },
  { dir: 'creds', ruleId: 'R014', minScore: 80 },
  { dir: 'curl-arg-passthrough', ruleId: 'R015', minScore: 60 },
  { dir: 'hardcoded-secret', ruleId: 'R016', minScore: 10 },
  { dir: 'autonomy-no-confirm', ruleId: 'R017', minScore: 30 },
  { dir: 'crypto-transactions', ruleId: 'R018', minScore: 30 },
  { dir: 'telemetry-sync', ruleId: 'R019', minScore: 30 },
  { dir: 'privileged-install', ruleId: 'R020', minScore: 30 },
  { dir: 'external-exec', ruleId: 'R021', minScore: 30 },
  { dir: 'safety-disabled', ruleId: 'R022', minScore: 80 },
  { dir: 'vcs-install', ruleId: 'R023', minScore: 30 },
  { dir: 'persistence', ruleId: 'R006', minScore: 60 },
  { dir: 'quarantine', ruleId: 'R007', minScore: 60 },
  { dir: 'multifile-curl', ruleId: 'R001', minScore: 80 },
  { dir: 'multifile-wget', ruleId: 'R002', minScore: 80 },
  { dir: 'multifile-powershell', ruleId: 'R003', minScore: 80 },
  { dir: 'multifile-base64', ruleId: 'R004', minScore: 60 },
  { dir: 'multifile-creds', ruleId: 'R014', minScore: 80 },
  { dir: 'multifile-persistence', ruleId: 'R006', minScore: 60 },
  { dir: 'multifile-quarantine', ruleId: 'R007', minScore: 60 },
];

for (const fixture of FIXTURES) {
  test(`scan fixtures flags ${fixture.dir} (${fixture.ruleId})`, async () => {
    const bundle = await buildFixtureBundle(fixture.dir);
    const report = scanSkillBundle(bundle);
    assert.equal(report.api_version, 1);
    assert.ok(report.findings.some((finding) => finding.rule_id === fixture.ruleId));
    assert.ok(report.risk_score >= fixture.minScore);
  });
}

test('scan fixtures flags kitchen-sink (all rules)', async () => {
  const bundle = await buildFixtureBundle('kitchen-sink');
  const report = scanSkillBundle(bundle);
  assert.equal(report.api_version, 1);
  const ids = new Set(report.findings.map((finding) => finding.rule_id));
  for (const id of ['R001', 'R002', 'R003', 'R004', 'R006', 'R007', 'R014']) {
    assert.ok(ids.has(id), `missing finding for ${id}`);
  }
  assert.ok(report.risk_score >= 90);
});

test('scan fixtures flags kitchen-sink-multifile (all rules)', async () => {
  const bundle = await buildFixtureBundle('kitchen-sink-multifile');
  const report = scanSkillBundle(bundle);
  assert.equal(report.api_version, 1);
  const ids = new Set(report.findings.map((finding) => finding.rule_id));
  for (const id of ['R001', 'R002', 'R003', 'R004', 'R006', 'R007', 'R014']) {
    assert.ok(ids.has(id), `missing finding for ${id}`);
  }
  assert.ok(report.risk_score >= 90);
});

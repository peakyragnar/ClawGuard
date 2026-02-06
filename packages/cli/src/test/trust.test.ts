import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'cli.js');

test('trust add + scan-source --mode trusted uses trusted stance when pinned', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawguard-trust-'));
  const trustStore = join(dir, 'trust.json');
  const fixture = join(here, '..', '..', '..', '..', 'fixtures', 'skills', 'bad', 'curl-arg-passthrough');

  const add = await new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, 'trust', 'add', fixture, '--trust-store', trustStore], { stdio: 'ignore', cwd: dir });
    child.on('close', (code) => resolve({ code }));
  });
  assert.equal(add.code, 0);

  // This fixture scores 60. Untrusted default denies (deny_at=60), trusted should be needs_approval (deny_at=80).
  const scan = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [cliPath, 'scan-source', fixture, '--mode', 'trusted', '--trust-store', trustStore],
      { stdio: ['ignore', 'pipe', 'ignore'], cwd: dir },
    );
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c) => (stdout += c));
    child.on('close', (code) => resolve({ code, stdout }));
  });

  assert.equal(scan.code, 3);
  const parsed = JSON.parse(scan.stdout) as any;
  assert.equal(parsed.mode_requested, 'trusted');
  assert.equal(parsed.mode_effective, 'trusted');
  assert.equal(parsed.trust.status, 'trusted');
});

test('scan-source --mode trusted falls back to untrusted when not pinned', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawguard-trust-'));
  const trustStore = join(dir, 'trust.json');
  const fixture = join(here, '..', '..', '..', '..', 'fixtures', 'skills', 'bad', 'curl-arg-passthrough');

  const scan = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [cliPath, 'scan-source', fixture, '--mode', 'trusted', '--trust-store', trustStore],
      { stdio: ['ignore', 'pipe', 'ignore'], cwd: dir },
    );
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c) => (stdout += c));
    child.on('close', (code) => resolve({ code, stdout }));
  });

  assert.equal(scan.code, 2);
  const parsed = JSON.parse(scan.stdout) as any;
  assert.equal(parsed.mode_effective, 'untrusted');
  assert.equal(parsed.trust.status, 'untrusted');
});


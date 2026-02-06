import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'cli.js');

test('ingest writes a receipt json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawguard-receipt-'));
  const receiptDir = join(dir, 'receipts');
  const fixtures = join(here, '..', '..', '..', '..', 'fixtures', 'skills', 'bad', 'curl');

  const result = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, 'ingest', fixtures, '--receipt-dir', receiptDir], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c) => (stdout += c));
    child.on('close', (code) => resolve({ code, stdout }));
  });

  assert.equal(result.code, 2);
  const receiptPath = result.stdout.trim();
  assert.ok(receiptPath.endsWith('.json'));
  const raw = await readFile(receiptPath, 'utf8');
  const parsed = JSON.parse(raw) as any;
  assert.equal(parsed.receipt_version, 1);
  assert.equal(parsed.action, 'deny');
  assert.ok(parsed.bundle?.content_sha256);
});


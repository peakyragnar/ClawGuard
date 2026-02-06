import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'cli.js');

test('cli --help exits 0', async () => {
  const result = await new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, '--help'], { stdio: 'ignore' });
    child.on('close', (code) => resolve({ code }));
  });
  assert.equal(result.code, 0);
});

test('cli eval-tool-call reads stdin', async () => {
  const payload = JSON.stringify({ tool_name: 'system_exec', args: { cmd: 'curl', args: ['x'] } });
  const result = await new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, 'eval-tool-call', '--stdin'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin?.write(payload);
    child.stdin?.end();
    child.on('close', (code) => resolve({ code }));
  });
  assert.equal(result.code, 3);
});

test('cli scan-dir returns deny when any skill is denied', async () => {
  const fixturesRoot = join(here, '..', '..', '..', '..', 'fixtures', 'skills', 'bad');
  const result = await new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, 'scan-dir', fixturesRoot], { stdio: 'ignore' });
    child.on('close', (code) => resolve({ code }));
  });
  assert.equal(result.code, 2);
});

test('cli scan-tree finds nested skills and returns deny when any skill is denied', async () => {
  const fixturesRoot = join(here, '..', '..', '..', '..', 'fixtures', 'skills');
  const result = await new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, 'scan-tree', fixturesRoot, '--max-skills', '50'], { stdio: 'ignore' });
    child.on('close', (code) => resolve({ code }));
  });
  assert.equal(result.code, 2);
});

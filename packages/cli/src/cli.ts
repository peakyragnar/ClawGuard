#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { mkdir } from 'node:fs/promises';
import {
  defaultPolicy,
  evaluateToolCall,
  loadDefaultRulePack,
  scanSkillBundle,
  type Policy,
  type ToolCallContext,
} from '@clawguard/core';
import { buildSkillBundleFromSource } from './source.js';
import { clampInt } from './limits.js';
import { bundleContentHash, bundleManifestHash, policyHash, type SkillReceipt } from './receipt.js';

type CommandHandler = (args: string[]) => Promise<number>;

function usage(): void {
  console.log(`clawguard <command>

Commands:
  scan-source <path|url|zip> [--policy <path>]
  scan-dir <skills-root> [--policy <path>] [--out <path>]
  ingest <path|url|zip> [--receipt-dir <path>] [--policy <path>]
  eval-tool-call --stdin [--policy <path>]
  rules list
  rules explain <id>
  policy init [--path <path>]
`);
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function readArgValue(args: string[], key: string): string | null {
  const idx = args.indexOf(key);
  if (idx < 0) return null;
  const value = args[idx + 1];
  return value ? value : null;
}

async function loadPolicyFromArgs(args: string[]): Promise<Policy> {
  const path = readArgValue(args, '--policy');
  if (path) {
    const data = await readJsonFile(path);
    return data as Policy;
  }
  return defaultPolicy();
}

function actionForScore(report: { risk_score: number }, policy: Policy): 'deny' | 'needs_approval' | 'allow' {
  const denyAt = policy.thresholds?.scan_deny_at ?? 80;
  const approveAt = policy.thresholds?.scan_approve_at ?? 40;
  if (report.risk_score >= denyAt) return 'deny';
  if (report.risk_score >= approveAt) return 'needs_approval';
  return 'allow';
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const myIdx = idx;
      idx += 1;
      if (myIdx >= items.length) break;
      out[myIdx] = await fn(items[myIdx] as T, myIdx);
    }
  });
  await Promise.all(workers);
  return out;
}

const commands: Record<string, CommandHandler> = {
  async 'scan-skill'(args) {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) {
      console.error('scan-skill requires <path>');
      return 1;
    }
    const policy = await loadPolicyFromArgs(args);
    const bundle = await buildSkillBundleFromSource(target);
    const report = scanSkillBundle(bundle);
    console.log(JSON.stringify(report, null, 2));
    const action = actionForScore(report, policy);
    return action === 'deny' ? 2 : action === 'needs_approval' ? 3 : 0;
  },

  async 'scan-source'(args) {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) {
      console.error('scan-source requires <path|url|zip>');
      return 1;
    }
    const policy = await loadPolicyFromArgs(args);

    const timeoutMsRaw = readArgValue(args, '--timeout-ms');
    const maxFilesRaw = readArgValue(args, '--max-files');
    const maxTotalBytesRaw = readArgValue(args, '--max-total-bytes');
    const maxZipBytesRaw = readArgValue(args, '--max-zip-bytes');
    const limits: Record<string, number> = {};
    if (timeoutMsRaw) limits.timeoutMs = clampInt(Number.parseInt(timeoutMsRaw, 10), 1000, 60_000);
    if (maxFilesRaw) limits.maxFiles = clampInt(Number.parseInt(maxFilesRaw, 10), 1, 2000);
    if (maxTotalBytesRaw) limits.maxTotalBytes = clampInt(Number.parseInt(maxTotalBytesRaw, 10), 1_000, 200_000_000);
    if (maxZipBytesRaw) limits.maxZipBytes = clampInt(Number.parseInt(maxZipBytesRaw, 10), 1_000, 200_000_000);

    const bundle = await buildSkillBundleFromSource(target, limits);
    const report = scanSkillBundle(bundle);
    console.log(
      JSON.stringify(
        {
          bundle: {
            id: bundle.id,
            entrypoint: bundle.entrypoint,
            files: bundle.files.length,
            manifest_entries: bundle.manifest?.length ?? 0,
            ingest_warnings: bundle.ingest_warnings ?? [],
            source: bundle.source,
          },
          report,
        },
        null,
        2,
      ),
    );
    const action = actionForScore(report, policy);
    return action === 'deny' ? 2 : action === 'needs_approval' ? 3 : 0;
  },

  async 'scan-dir'(args) {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) {
      console.error('scan-dir requires <skills-root>');
      return 1;
    }
    const outPath = readArgValue(args, '--out');
    const policy = await loadPolicyFromArgs(args);

    const entries = await readdir(target, { withFileTypes: true });
    const results: Array<{
      skill: string;
      path: string;
      action: 'allow' | 'needs_approval' | 'deny';
      risk_score: number;
      findings: number;
    }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(target, entry.name);
      if (!existsSync(join(skillDir, 'SKILL.md'))) continue;
      const bundle = await buildSkillBundleFromSource(skillDir);
      const report = scanSkillBundle(bundle);
      const action = actionForScore(report, policy);
      results.push({
        skill: entry.name,
        path: skillDir,
        action,
        risk_score: report.risk_score,
        findings: report.findings.length,
      });
    }

    if (outPath) {
      const jsonl = results.map((row) => JSON.stringify(row)).join('\n') + '\n';
      await writeFile(outPath, jsonl, 'utf8');
      console.log(outPath);
    } else {
      console.log(JSON.stringify(results, null, 2));
    }

    return results.some((row) => row.action === 'deny') ? 2 : results.some((row) => row.action === 'needs_approval') ? 3 : 0;
  },

  async ingest(args) {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) {
      console.error('ingest requires <path|url|zip>');
      return 1;
    }
    const policy = await loadPolicyFromArgs(args);
    const receiptDir = readArgValue(args, '--receipt-dir') ?? join(process.cwd(), '.clawguard', 'receipts');

    const bundle = await buildSkillBundleFromSource(target, {});
    const report = scanSkillBundle(bundle);
    const action = actionForScore(report, policy);

    const { sha256, totalBytes } = bundleContentHash(bundle);
    const manifestSha = bundleManifestHash(bundle);
    const receipt: SkillReceipt = {
      receipt_version: 1,
      created_at: new Date().toISOString(),
      source_input: target,
      bundle: {
        id: bundle.id,
        source: bundle.source,
        entrypoint: bundle.entrypoint,
        file_count: bundle.files.length,
        manifest_count: bundle.manifest?.length ?? 0,
        ingest_warnings: bundle.ingest_warnings ?? [],
        total_bytes: totalBytes,
        content_sha256: sha256,
        manifest_sha256: manifestSha ?? void 0,
      },
      policy_sha256: policyHash(policy),
      scan_report: report,
    };

    await mkdir(receiptDir, { recursive: true });
    const path = join(receiptDir, `${sha256}.json`);
    await writeFile(path, `${JSON.stringify({ action, ...receipt }, null, 2)}\n`, 'utf8');
    console.log(path);

    return action === 'deny' ? 2 : action === 'needs_approval' ? 3 : 0;
  },

  async 'eval-tool-call'(args) {
    if (!args.includes('--stdin')) {
      console.error('eval-tool-call requires --stdin');
      return 1;
    }
    const policy = await loadPolicyFromArgs(args);
    const stdin = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => resolve(data.trim()));
    });
    const payload = JSON.parse(stdin) as ToolCallContext;
    const decision = evaluateToolCall(payload, policy);
    console.log(JSON.stringify(decision, null, 2));
    return decision.action === 'deny' ? 2 : decision.action === 'needs_approval' ? 3 : 0;
  },

  async rules(args) {
    const sub = args[0];
    const pack = loadDefaultRulePack();
    if (sub === 'list') {
      const list = pack.rules.map((rule) => ({ id: rule.id, title: rule.title, severity: rule.severity }));
      console.log(JSON.stringify(list, null, 2));
      return 0;
    }
    if (sub === 'explain' && args[1]) {
      const rule = pack.rules.find((entry) => entry.id === args[1]);
      if (!rule) {
        console.error('rule not found');
        return 1;
      }
      console.log(JSON.stringify(rule, null, 2));
      return 0;
    }
    console.error('rules requires list|explain <id>');
    return 1;
  },

  async policy(args) {
    const sub = args[0];
    if (sub !== 'init') {
      console.error('policy requires init');
      return 1;
    }
    const idx = args.indexOf('--path');
    const path = idx >= 0 && args[idx + 1] ? args[idx + 1] : 'clawguard.policy.json';
    const policy = defaultPolicy();
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path, `${JSON.stringify(policy, null, 2)}\n`, 'utf8'));
    console.log(path);
    return 0;
  },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    usage();
    process.exit(0);
  }
  const command = args[0];
  const handler = commands[command];
  if (!handler) {
    usage();
    process.exit(1);
  }
  const code = await handler(args.slice(1));
  process.exit(code);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});

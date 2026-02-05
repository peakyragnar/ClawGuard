#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import process from 'node:process';
import {
  defaultPolicy,
  evaluateToolCall,
  loadDefaultRulePack,
  scanSkillBundle,
  type Policy,
  type SkillBundle,
  type ToolCallContext,
} from '@clawguard/core';

type CommandHandler = (args: string[]) => Promise<number>;

function usage(): void {
  console.log(`clawguard <command>

Commands:
  scan-skill <path> [--policy <path>]
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

async function loadPolicyFromArgs(args: string[]): Promise<Policy> {
  const idx = args.indexOf('--policy');
  if (idx >= 0 && args[idx + 1]) {
    const path = args[idx + 1];
    const data = await readJsonFile(path);
    return data as Policy;
  }
  return defaultPolicy();
}

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

async function buildSkillBundle(path: string): Promise<SkillBundle> {
  const files: SkillBundle['files'] = [];
  const rootFiles = await readDirRecursive(path);
  for (const filePath of rootFiles) {
    const content = await readTextFile(filePath);
    if (content === null) continue;
    files.push({
      path: filePath.replace(`${path}/`, ''),
      content_text: content,
    });
  }
  const entrypoint = existsSync(join(path, 'SKILL.md')) ? 'SKILL.md' : basename(path);
  return {
    id: basename(path),
    entrypoint,
    files,
    source: 'local',
  };
}

const commands: Record<string, CommandHandler> = {
  async 'scan-skill'(args) {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) {
      console.error('scan-skill requires <path>');
      return 1;
    }
    const policy = await loadPolicyFromArgs(args);
    const bundle = await buildSkillBundle(target);
    const report = scanSkillBundle(bundle);
    console.log(JSON.stringify(report, null, 2));
    const denyAt = policy.thresholds?.scan_deny_at ?? 80;
    const approveAt = policy.thresholds?.scan_approve_at ?? 40;
    if (report.risk_score >= denyAt) return 2;
    if (report.risk_score >= approveAt) return 3;
    return 0;
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

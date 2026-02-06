#!/usr/bin/env node
import { readFile, readdir, stat, lstat, writeFile } from 'node:fs/promises';
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
import { createClawhubClient, fetchSkillReadme, listSkills, type ClawhubScanLimits } from './clawhub.js';

type CommandHandler = (args: string[]) => Promise<number>;

function usage(): void {
  console.log(`clawguard <command>

Commands:
  scan-skill <path> [--policy <path>]
  scan-dir <skills-root> [--policy <path>] [--out <path>]
  scan-clawhub [--limit <n>] [--convex-url <url>] [--out <path>] [--policy <path>]
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

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function isLikelyTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.bash') ||
    lower.endsWith('.zsh') ||
    lower.endsWith('.ps1') ||
    lower.endsWith('.py') ||
    lower.endsWith('.js') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.ts')
  );
}

function shouldSkipDir(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist' || name === 'build' || name === '.pnpm';
}

type WalkLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxDepth: number;
};

const DEFAULT_LIMITS: WalkLimits = {
  maxFiles: 200,
  maxTotalBytes: 5_000_000,
  maxFileBytes: 1_000_000,
  maxDepth: 8,
};

async function readDirRecursive(root: string, limits: WalkLimits): Promise<string[]> {
  const out: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const { dir, depth } = item;
    if (depth > limits.maxDepth) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= limits.maxFiles) return out;
      const full = join(dir, entry.name);
      let st: { isSymbolicLink: () => boolean } | null = null;
      try {
        st = await lstat(full);
      } catch {
        st = null;
      }
      if (st && st.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

async function buildSkillBundle(path: string): Promise<SkillBundle> {
  const limits = DEFAULT_LIMITS;
  const files: SkillBundle['files'] = [];
  let totalBytes = 0;
  const rootFiles = await readDirRecursive(path, limits);
  for (const filePath of rootFiles) {
    if (!isLikelyTextFile(filePath)) continue;
    const size = await stat(filePath).then((s) => s.size).catch(() => 0);
    if (size <= 0) continue;
    if (size > limits.maxFileBytes) continue;
    if (totalBytes + size > limits.maxTotalBytes) break;
    const content = await readTextFile(filePath);
    if (content === null) continue;
    totalBytes += size;
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
    const bundle = await buildSkillBundle(target);
    const report = scanSkillBundle(bundle);
    console.log(JSON.stringify(report, null, 2));
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
      const bundle = await buildSkillBundle(skillDir);
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

  async 'scan-clawhub'(args) {
    const policy = await loadPolicyFromArgs(args);
    const outPath = readArgValue(args, '--out');
    const limitRaw = readArgValue(args, '--limit');
    const convexUrl = readArgValue(args, '--convex-url') ?? 'https://wry-manatee-359.convex.cloud';

    const limit = Math.min(500, Math.max(1, limitRaw ? Number.parseInt(limitRaw, 10) : 200));

    const HARD_LIMITS: ClawhubScanLimits = {
      maxSkills: 500,
      maxListResponseBytes: 8_000_000,
      maxSkillMdBytes: 512 * 1024,
      timeoutMs: 12_000,
      retries: 2,
      concurrency: 6,
    };

    const client = createClawhubClient({ baseUrl: convexUrl, limits: HARD_LIMITS });
    const skills = await listSkills(client, limit);

    const results = await mapPool(skills, HARD_LIMITS.concurrency, async (entry) => {
      const slug = entry.skill?.slug ?? 'unknown';
      const owner = entry.ownerHandle ?? (entry.skill?.ownerUserId !== void 0 ? String(entry.skill.ownerUserId) : null);
      const versionId = entry.latestVersion._id;
      const version = entry.latestVersion.version ?? null;

      try {
        const readme = await fetchSkillReadme(client, versionId);
        const bytes = Buffer.byteLength(readme.text, 'utf8');
        if (bytes > HARD_LIMITS.maxSkillMdBytes) {
          return {
            source: 'clawhub',
            owner,
            slug,
            version,
            versionId,
            action: 'needs_approval' as const,
            error: `SKILL.md exceeds max bytes (${bytes} > ${HARD_LIMITS.maxSkillMdBytes})`,
          };
        }

        const bundle: SkillBundle = {
          id: owner ? `${owner}/${slug}` : slug,
          entrypoint: 'SKILL.md',
          files: [{ path: 'SKILL.md', content_text: readme.text }],
          source: 'clawhub',
        };
        const report = scanSkillBundle(bundle);
        const action = actionForScore(report, policy);
        return {
          source: 'clawhub',
          owner,
          slug,
          version,
          versionId,
          action,
          risk_score: report.risk_score,
          findings: report.findings,
        };
      } catch (err) {
        return {
          source: 'clawhub',
          owner,
          slug,
          version,
          versionId,
          action: 'needs_approval' as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    if (outPath) {
      const jsonl = results.map((row) => JSON.stringify(row)).join('\n') + '\n';
      await writeFile(outPath, jsonl, 'utf8');
      console.log(outPath);
    } else {
      console.log(JSON.stringify(results, null, 2));
    }

    const deny = results.some((r: any) => r.action === 'deny');
    const needs = results.some((r: any) => r.action === 'needs_approval');
    return deny ? 2 : needs ? 3 : 0;
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

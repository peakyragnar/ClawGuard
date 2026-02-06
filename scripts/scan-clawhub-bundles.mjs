#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { scanSkillBundle, defaultPolicy } from '../packages/core/dist/index.js';

// Uses built artifacts from the workspace packages. Run `pnpm -r build` first.
import { createClawhubClient, listSkills } from '../packages/cli/dist/clawhub.js';
import { fetchBytesLimited } from '../packages/cli/dist/http.js';
import { buildSkillBundleFromZipBytes } from '../packages/cli/dist/source.js';

function readArgValue(args, key) {
  const idx = args.indexOf(key);
  if (idx < 0) return null;
  const value = args[idx + 1];
  return value ? value : null;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const myIdx = idx;
      idx += 1;
      if (myIdx >= items.length) break;
      out[myIdx] = await fn(items[myIdx], myIdx);
    }
  });
  await Promise.all(workers);
  return out;
}

function actionForScore(report, policy) {
  const denyAt = policy.thresholds?.scan_deny_at ?? 80;
  const approveAt = policy.thresholds?.scan_approve_at ?? 40;
  if (report.risk_score >= denyAt) return 'deny';
  if (report.risk_score >= approveAt) return 'needs_approval';
  return 'allow';
}

function buildDownloadUrl(downloadBase, slug) {
  const u = new URL(downloadBase);
  u.searchParams.set('slug', slug);
  return u.toString();
}

function isZipBytes(bytes, contentType) {
  if (contentType && contentType.toLowerCase().includes('zip')) return true;
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`scan-clawhub-bundles.mjs

Usage:
  node scripts/scan-clawhub-bundles.mjs --limit 200 --out /tmp/out.jsonl

Options:
  --limit <n>
  --out <path>
  --convex-url <url>        default: https://wry-manatee-359.convex.cloud
  --download-base <url>     default: https://auth.clawdhub.com/api/v1/download
  --concurrency <n>         default: 4
`);
    process.exit(0);
  }

  const limit = clampInt(Number.parseInt(readArgValue(args, '--limit') ?? '200', 10), 1, 500);
  const outPath = readArgValue(args, '--out') ?? `/tmp/clawhub-bundles-${limit}.jsonl`;
  const convexUrl = readArgValue(args, '--convex-url') ?? 'https://wry-manatee-359.convex.cloud';
  const downloadBase = readArgValue(args, '--download-base') ?? 'https://auth.clawdhub.com/api/v1/download';
  const concurrency = clampInt(Number.parseInt(readArgValue(args, '--concurrency') ?? '4', 10), 1, 20);

  const policy = defaultPolicy();
  const LIMITS = {
    maxSkills: 500,
    maxListResponseBytes: 8_000_000,
    maxSkillMdBytes: 512 * 1024,
    timeoutMs: 12_000,
    retries: 2,
    concurrency,
    maxZipBytes: 25_000_000,
    maxFiles: 800,
    maxTotalBytes: 6_000_000,
    maxZipEntryBytes: 1_000_000,
  };

  const client = createClawhubClient({ baseUrl: convexUrl, limits: LIMITS });
  const skills = await listSkills(client, limit);

  const results = await mapPool(skills, LIMITS.concurrency, async (entry) => {
    const slug = entry.skill?.slug ?? 'unknown';
    const owner = entry.ownerHandle ?? (entry.skill?.ownerUserId !== void 0 ? String(entry.skill.ownerUserId) : null);
    const versionId = entry.latestVersion._id;
    const version = entry.latestVersion.version ?? null;

    try {
      const url = buildDownloadUrl(downloadBase, slug);
      const { bytes, contentType } = await fetchBytesLimited(url, { timeoutMs: LIMITS.timeoutMs, maxBytes: LIMITS.maxZipBytes, retries: LIMITS.retries });
      if (!isZipBytes(bytes, contentType)) {
        return { source: 'clawhub', owner, slug, version, versionId, action: 'needs_approval', error: `download did not return zip (content-type=${contentType ?? 'unknown'})` };
      }

      const bundle = buildSkillBundleFromZipBytes(bytes, owner ? `${owner}/${slug}` : slug, {
        maxFiles: LIMITS.maxFiles,
        maxTotalBytes: LIMITS.maxTotalBytes,
        maxZipBytes: LIMITS.maxZipBytes,
        maxZipEntryBytes: LIMITS.maxZipEntryBytes,
        timeoutMs: LIMITS.timeoutMs,
        retries: LIMITS.retries,
      });
      bundle.source = 'clawhub';
      bundle.version = version ?? undefined;

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
        manifest_entries: bundle.manifest?.length ?? 0,
        ingest_warnings: bundle.ingest_warnings ?? [],
      };
    } catch (err) {
      return { source: 'clawhub', owner, slug, version, versionId, action: 'needs_approval', error: String(err) };
    }
  });

  const jsonl = results.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(outPath, jsonl, 'utf8');
  console.log(outPath);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});

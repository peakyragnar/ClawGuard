#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { scanSkillBundle, defaultPolicy } from '../packages/core/dist/index.js';
import { createClawhubClient } from '../packages/cli/dist/clawhub.js';
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

function nowIso() {
  return new Date().toISOString();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildDownloadUrl(downloadBase, slug, version) {
  const u = new URL(downloadBase);
  u.searchParams.set('slug', slug);
  if (version) u.searchParams.set('version', version);
  return u.toString();
}

function isZipBytes(bytes, contentType) {
  if (contentType && contentType.toLowerCase().includes('zip')) return true;
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function parseClawhubPage(value) {
  const v = value ?? {};
  const page = Array.isArray(v.page) ? v.page : [];
  const isDone = Boolean(v.isDone);
  const continueCursor = typeof v.continueCursor === 'string' ? v.continueCursor : null;
  return { page, isDone, continueCursor };
}

async function loadState(statePath) {
  try {
    const raw = await readFile(statePath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

async function saveStateAtomic(statePath, state) {
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await rename(tmp, statePath);
}

async function fetchVtResult(client, sha256hash, limits) {
  if (!sha256hash) return null;
  // ClawHub uses a Convex action here (not a query).
  const value = await client.action('vt:fetchResults', { sha256hash });
  const status = typeof value?.status === 'string' ? value.status : 'unknown';
  const url = typeof value?.url === 'string' ? value.url : null;
  const source = typeof value?.source === 'string' ? value.source : null;
  const aiAnalysis = typeof value?.metadata?.aiAnalysis === 'string' ? value.metadata.aiAnalysis : null;
  const maxAnalysis = limits.maxAiAnalysisChars ?? 6000;
  return {
    status,
    url,
    source,
    metadata: {
      aiAnalysis: aiAnalysis ? aiAnalysis.slice(0, maxAnalysis) : null,
      truncated: Boolean(aiAnalysis && aiAnalysis.length > maxAnalysis),
    },
  };
}

function expectedActionFromVtStatus(status) {
  const s = (status ?? '').toLowerCase();
  if (s === 'malicious') return 'deny';
  if (s === 'suspicious') return 'needs_approval';
  if (s === 'benign' || s === 'clean') return 'allow';
  return 'unknown';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`scan-corpus.mjs

Goal:
  Build a reproducible corpus + diff-queue against ClawHub's VirusTotal/Code-Insight signal.

Usage:
  pnpm -r build
  node scripts/scan-corpus.mjs --max-skills 200 --out /tmp/corpus.jsonl

Options:
  --max-skills <n>          default: 200 (hard max: 20000)
  --out <path>              default: /tmp/clawhub-corpus.jsonl
  --state <path>            default: ./.clawguard/corpus-state.json
  --resume                  default: true (set --no-resume to ignore state)
  --include-vt              default: true (set --no-include-vt to skip VT/AI analysis)
  --convex-url <url>        default: https://wry-manatee-359.convex.cloud
  --download-base <url>     default: https://auth.clawdhub.com/api/v1/download
  --concurrency <n>         default: 3
  --page-size <n>           default: 50 (max 100)
  --sleep-ms <n>            default: 150 (between pages)

Hard safety caps (can override some):
  --timeout-ms <n>          default: 12000 (max 60000)
  --retries <n>             default: 2
  --max-zip-bytes <n>       default: 25000000
  --max-files <n>           default: 800
  --max-total-bytes <n>     default: 6000000
  --max-zip-entry-bytes <n> default: 1000000
`);
    process.exit(0);
  }

  const outPath = readArgValue(args, '--out') ?? '/tmp/clawhub-corpus.jsonl';
  const statePath = readArgValue(args, '--state') ?? `${process.cwd()}/.clawguard/corpus-state.json`;

  const resume = !args.includes('--no-resume');
  const includeVt = !args.includes('--no-include-vt');

  const maxSkills = clampInt(Number.parseInt(readArgValue(args, '--max-skills') ?? '200', 10), 1, 20000);
  const pageSize = clampInt(Number.parseInt(readArgValue(args, '--page-size') ?? '50', 10), 1, 100);
  const sleepMs = clampInt(Number.parseInt(readArgValue(args, '--sleep-ms') ?? '150', 10), 0, 5000);

  const convexUrl = readArgValue(args, '--convex-url') ?? 'https://wry-manatee-359.convex.cloud';
  const downloadBase = readArgValue(args, '--download-base') ?? 'https://auth.clawdhub.com/api/v1/download';

  const concurrency = clampInt(Number.parseInt(readArgValue(args, '--concurrency') ?? '3', 10), 1, 10);
  const timeoutMs = clampInt(Number.parseInt(readArgValue(args, '--timeout-ms') ?? '12000', 10), 1000, 60_000);
  const retries = clampInt(Number.parseInt(readArgValue(args, '--retries') ?? '2', 10), 0, 5);
  const maxZipBytes = clampInt(Number.parseInt(readArgValue(args, '--max-zip-bytes') ?? '25000000', 10), 50_000, 200_000_000);
  const maxFiles = clampInt(Number.parseInt(readArgValue(args, '--max-files') ?? '800', 10), 1, 2000);
  const maxTotalBytes = clampInt(Number.parseInt(readArgValue(args, '--max-total-bytes') ?? '6000000', 10), 10_000, 200_000_000);
  const maxZipEntryBytes = clampInt(Number.parseInt(readArgValue(args, '--max-zip-entry-bytes') ?? '1000000', 10), 1000, 50_000_000);

  const policy = defaultPolicy();

  const LIMITS = {
    timeoutMs,
    retries,
    concurrency,
    maxZipBytes,
    maxFiles,
    maxTotalBytes,
    maxZipEntryBytes,
    // keep the AI analysis payload bounded in the corpus output
    maxAiAnalysisChars: 8000,
    maxListResponseBytes: 8_000_000,
    maxSkillMdBytes: 512 * 1024,
    maxSkills: 20000,
  };

  await mkdir(`${process.cwd()}/.clawguard`, { recursive: true });

  const client = createClawhubClient({ baseUrl: convexUrl, limits: LIMITS });
  const outStream = createWriteStream(outPath, { flags: resume ? 'a' : 'w' });

  let state = resume ? await loadState(statePath) : null;
  if (!state || typeof state !== 'object') {
    state = { startedAt: nowIso(), cursor: null, processed: 0, maxSkills };
  }

  let cursor = typeof state.cursor === 'string' ? state.cursor : null;
  let processed = typeof state.processed === 'number' ? state.processed : 0;

  while (processed < maxSkills) {
    const pageValue = await client.query('skills:listPublicPageV2', { paginationOpts: { numItems: Math.min(pageSize, maxSkills - processed), cursor } });
    const { page, isDone, continueCursor } = parseClawhubPage(pageValue);
    if (page.length === 0) break;

    const results = await mapPool(page, concurrency, async (entry) => {
      const slug = entry?.skill?.slug ?? 'unknown';
      const owner = entry?.ownerHandle ?? (entry?.skill?.ownerUserId !== void 0 ? String(entry.skill.ownerUserId) : null);
      const versionId = entry?.latestVersion?._id ?? null;
      const version = entry?.latestVersion?.version ?? null;
      const sha256hash = entry?.latestVersion?.sha256hash ?? null;

      const rowBase = {
        source: 'clawhub',
        owner,
        slug,
        version,
        versionId,
        fetched_at: nowIso(),
      };

      try {
        const vt = includeVt ? await fetchVtResult(client, sha256hash, LIMITS) : null;

        const url = buildDownloadUrl(downloadBase, slug, version);
        const { bytes, contentType } = await fetchBytesLimited(url, {
          timeoutMs: LIMITS.timeoutMs,
          maxBytes: LIMITS.maxZipBytes,
          retries: LIMITS.retries,
        });
        if (!isZipBytes(bytes, contentType)) {
          return {
            ...rowBase,
            action: 'needs_approval',
            error: `download did not return zip (content-type=${contentType ?? 'unknown'})`,
            clawhub_vt: vt,
          };
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

        const vtStatus = vt?.status ?? null;
        const expected = includeVt ? expectedActionFromVtStatus(vtStatus) : 'unknown';
        const aligns = expected === 'unknown' ? null : expected === action;

        return {
          ...rowBase,
          action,
          risk_score: report.risk_score,
          findings: report.findings,
          reasons: Array.from(new Set((report.findings ?? []).map((f) => f.rule_id))),
          manifest_entries: bundle.manifest?.length ?? 0,
          ingest_warnings: bundle.ingest_warnings ?? [],
          clawhub_vt: vt,
          label_expected_action: expected,
          label_aligns: aligns,
        };
      } catch (err) {
        return { ...rowBase, action: 'needs_approval', error: String(err) };
      }
    });

    for (const row of results) {
      outStream.write(JSON.stringify(row) + '\n');
      processed += 1;
      if (processed >= maxSkills) break;
    }

    cursor = continueCursor;
    state.cursor = cursor;
    state.processed = processed;
    state.updatedAt = nowIso();
    await saveStateAtomic(statePath, state);

    if (isDone || !cursor) break;
    if (sleepMs > 0) await sleep(sleepMs);
  }

  outStream.end();
  console.log(outPath);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});


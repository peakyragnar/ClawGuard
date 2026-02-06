import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bundleContentHash, bundleManifestHash, sha256Hex } from './receipt.js';
import type { SkillBundle } from '@clawguard/core';

export type TrustRecord = {
  trust_version: 1;
  created_at: string;
  source_input: string;
  content_sha256: string;
  manifest_sha256?: string;
};

export type TrustStore = {
  trust_store_version: 1;
  records: TrustRecord[];
};

export type TrustStatus =
  | { status: 'trusted'; record: TrustRecord }
  | { status: 'untrusted'; reason: 'not_pinned' | 'changed' };

function emptyStore(): TrustStore {
  return { trust_store_version: 1, records: [] };
}

export function defaultTrustStorePath(cwd: string): string {
  return join(cwd, '.clawguard', 'trust.json');
}

export async function loadTrustStore(path: string): Promise<TrustStore> {
  if (!existsSync(path)) return emptyStore();
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as any;
  if (!parsed || parsed.trust_store_version !== 1 || !Array.isArray(parsed.records)) return emptyStore();
  return { trust_store_version: 1, records: parsed.records as TrustRecord[] };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${sha256Hex(Buffer.from(String(Date.now()), 'utf8')).slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await import('node:fs/promises').then(({ rename }) => rename(tmp, path));
}

export function trustRecordForBundle(bundle: SkillBundle, source_input: string): TrustRecord {
  const { sha256 } = bundleContentHash(bundle);
  const manifestSha = bundleManifestHash(bundle) ?? void 0;
  return {
    trust_version: 1,
    created_at: new Date().toISOString(),
    source_input,
    content_sha256: sha256,
    ...(manifestSha ? { manifest_sha256: manifestSha } : {}),
  };
}

export function trustStatusForBundle(bundle: SkillBundle, store: TrustStore): TrustStatus {
  const { sha256 } = bundleContentHash(bundle);
  const manifestSha = bundleManifestHash(bundle) ?? void 0;
  const match = store.records.find((r) => {
    if (r.content_sha256 !== sha256) return false;
    if (manifestSha && r.manifest_sha256 && r.manifest_sha256 !== manifestSha) return false;
    return true;
  });
  if (match) return { status: 'trusted', record: match };
  return { status: 'untrusted', reason: 'not_pinned' };
}

export async function addTrustRecord(path: string, record: TrustRecord): Promise<TrustStore> {
  const store = await loadTrustStore(path);
  const dedup = store.records.filter((r) => r.content_sha256 !== record.content_sha256);
  const next: TrustStore = { trust_store_version: 1, records: [record, ...dedup].slice(0, 5000) };
  await atomicWriteJson(path, next);
  return next;
}

export async function removeTrustByHash(path: string, content_sha256: string): Promise<TrustStore> {
  const store = await loadTrustStore(path);
  const next: TrustStore = { trust_store_version: 1, records: store.records.filter((r) => r.content_sha256 !== content_sha256) };
  await atomicWriteJson(path, next);
  return next;
}

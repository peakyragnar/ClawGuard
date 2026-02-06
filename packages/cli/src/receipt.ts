import { createHash } from 'node:crypto';
import type { Policy, ScanReport, SkillBundle } from '@clawguard/core';

export type SkillReceipt = {
  receipt_version: 1;
  created_at: string;
  source_input: string;
  bundle: {
    id: string;
    source?: SkillBundle['source'];
    entrypoint: string;
    file_count: number;
    manifest_count?: number;
    ingest_warnings?: string[];
    total_bytes: number;
    content_sha256: string;
    manifest_sha256?: string;
  };
  policy_sha256: string;
  scan_report: ScanReport;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function policyHash(policy: Policy): string {
  return sha256Hex(Buffer.from(JSON.stringify(policy), 'utf8'));
}

export function bundleContentHash(bundle: SkillBundle): { sha256: string; totalBytes: number } {
  const hash = createHash('sha256');
  let total = 0;
  const files = [...bundle.files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    hash.update(file.path);
    hash.update('\n');
    if (file.content_text) {
      const buf = Buffer.from(file.content_text, 'utf8');
      total += buf.byteLength;
      hash.update(buf);
    } else if (file.content_bytes_b64) {
      const buf = Buffer.from(file.content_bytes_b64, 'base64');
      total += buf.byteLength;
      hash.update(buf);
    }
    hash.update('\n');
  }
  return { sha256: hash.digest('hex'), totalBytes: total };
}

export function bundleManifestHash(bundle: SkillBundle): string | null {
  if (!bundle.manifest || bundle.manifest.length === 0) return null;
  const hash = createHash('sha256');
  const entries = [...bundle.manifest].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update('\n');
    hash.update(String(entry.size_bytes ?? ''));
    hash.update('\n');
    hash.update(entry.sha256 ?? '');
    hash.update('\n');
    hash.update(entry.sha256_partial ? 'partial' : '');
    hash.update('\n');
    hash.update(entry.is_binary ? 'binary' : '');
    hash.update('\n');
    hash.update(entry.is_executable ? 'exec' : '');
    hash.update('\n');
    hash.update(entry.is_symlink ? 'symlink' : '');
    hash.update('\n');
    hash.update(entry.is_archive ? 'archive' : '');
    hash.update('\n');
    hash.update(entry.skipped_reason ?? '');
    hash.update('\n');
  }
  return hash.digest('hex');
}

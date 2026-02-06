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
    total_bytes: number;
    content_sha256: string;
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


import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SkillBundle } from '@clawguard/core';
import { DEFAULT_INGEST_LIMITS, type IngestLimits } from './limits.js';
import { fetchBytesLimited } from './http.js';
import { decodeUtf8, isLikelyTextPath, looksBinary } from './text.js';
import { extractZipEntry, listZipEntries, selectZipFilesForScan, type ZipLimits } from './zip.js';

function shouldSkipDir(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist' || name === 'build' || name === '.pnpm';
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function walkDir(root: string, limits: IngestLimits): Promise<string[]> {
  const out: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const { dir, depth } = item;
    if (depth > 8) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= limits.maxFiles) return out;
      const full = join(dir, entry.name);
      const st = await lstat(full).catch(() => null);
      if (st?.isSymbolicLink()) continue;
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

async function buildBundleFromDir(path: string, limits: IngestLimits): Promise<SkillBundle> {
  const files: SkillBundle['files'] = [];
  let totalBytes = 0;
  const paths = await walkDir(path, limits);
  for (const filePath of paths) {
    const rel = filePath.replace(`${path}/`, '');
    if (!isLikelyTextPath(rel)) continue;
    const size = await stat(filePath).then((s) => s.size).catch(() => 0);
    if (size <= 0) continue;
    if (size > limits.maxFileBytes) continue;
    if (totalBytes + size > limits.maxTotalBytes) break;
    const content = await readTextFile(filePath);
    if (content === null) continue;
    totalBytes += size;
    files.push({ path: rel, content_text: content });
  }
  const entrypoint = existsSync(join(path, 'SKILL.md')) ? 'SKILL.md' : basename(path);
  return { id: basename(path), entrypoint, files, source: 'local' };
}

function isZipBytes(bytes: Buffer, contentType: string | null): boolean {
  if (contentType && contentType.toLowerCase().includes('zip')) return true;
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function zipLimitsFromIngest(limits: IngestLimits): ZipLimits {
  return {
    maxEntries: limits.maxFiles,
    maxTotalUncompressedBytes: limits.maxTotalBytes,
    maxEntryBytes: limits.maxZipEntryBytes,
  };
}

function buildBundleFromZipBytes(bytes: Buffer, limits: IngestLimits, id: string): SkillBundle {
  const zLimits = zipLimitsFromIngest(limits);
  const entries = listZipEntries(bytes, zLimits);
  const picked = selectZipFilesForScan(entries, zLimits);

  const files: SkillBundle['files'] = [];
  for (const entry of picked) {
    if (!isLikelyTextPath(entry.name)) continue;
    const contentBytes = extractZipEntry(bytes, entry, zLimits);
    if (!contentBytes) continue;
    if (looksBinary(contentBytes)) continue;
    files.push({ path: entry.name, content_text: decodeUtf8(contentBytes) });
  }

  const entrypoint = files.some((f) => f.path.toLowerCase() === 'skill.md') ? 'SKILL.md' : 'SKILL.md';
  return { id, entrypoint, files, source: 'unknown' };
}

export type SourceSpec =
  | { kind: 'dir'; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string };

export function parseSourceSpec(raw: string): SourceSpec {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return { kind: 'url', url: raw };
  return { kind: 'dir', path: raw };
}

export async function buildSkillBundleFromSource(raw: string, limits: Partial<IngestLimits> = {}): Promise<SkillBundle> {
  const spec = parseSourceSpec(raw);
  const merged: IngestLimits = { ...DEFAULT_INGEST_LIMITS, ...limits };

  if (spec.kind === 'dir') {
    const st = await stat(spec.path).catch(() => null);
    if (st?.isFile()) {
      const bytes = await readFile(spec.path);
      if (bytes.length > merged.maxZipBytes) throw new Error(`file exceeds maxZipBytes=${merged.maxZipBytes}`);
      const id = basename(spec.path);
      return buildBundleFromZipBytes(bytes, merged, id);
    }
    return buildBundleFromDir(spec.path, merged);
  }

  if (spec.kind === 'file') {
    const bytes = await readFile(spec.path);
    if (bytes.length > merged.maxZipBytes) throw new Error(`file exceeds maxZipBytes=${merged.maxZipBytes}`);
    const id = basename(spec.path);
    return buildBundleFromZipBytes(bytes, merged, id);
  }

  const { bytes, contentType } = await fetchBytesLimited(spec.url, { timeoutMs: merged.timeoutMs, maxBytes: merged.maxZipBytes, retries: merged.retries });
  if (isZipBytes(bytes, contentType)) {
    return buildBundleFromZipBytes(bytes, merged, spec.url);
  }
  if (looksBinary(bytes)) throw new Error('remote content looks binary (expected SKILL.md or zip)');
  return {
    id: spec.url,
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: decodeUtf8(bytes) }],
    source: 'unknown',
  };
}

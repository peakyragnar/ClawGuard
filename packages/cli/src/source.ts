import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SkillBundle, SkillManifestEntry } from '@clawguard/core';
import { DEFAULT_INGEST_LIMITS, type IngestLimits } from './limits.js';
import { fetchBytesLimited } from './http.js';
import { decodeUtf8, isLikelyTextPath, looksBinary } from './text.js';
import {
  extractZipEntry,
  listZipEntriesWithDiagnostics,
  selectZipFilesForScan,
  type ZipLimits,
  zipEntryIsExecutable,
  zipEntryIsSymlink,
} from './zip.js';

function shouldSkipDir(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist' || name === 'build' || name === '.pnpm';
}

function isArchivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.bz2') ||
    lower.endsWith('.xz') ||
    lower.endsWith('.7z') ||
    lower.endsWith('.rar')
  );
}

function isSafeBinaryAssetPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.mp3') ||
    lower.endsWith('.wav') ||
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.woff') ||
    lower.endsWith('.woff2') ||
    lower.endsWith('.ttf') ||
    lower.endsWith('.otf')
  );
}

function isSuspiciousBinaryPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.exe') ||
    lower.endsWith('.dll') ||
    lower.endsWith('.dylib') ||
    lower.endsWith('.so') ||
    lower.endsWith('.node') ||
    lower.endsWith('.app') ||
    lower.endsWith('.pkg') ||
    lower.endsWith('.dmg') ||
    lower.endsWith('.msi') ||
    lower.endsWith('.wasm')
  );
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

type WalkItem = { fullPath: string; relPath: string; kind: 'file' | 'symlink' };

async function walkDir(root: string, limits: IngestLimits): Promise<{ items: WalkItem[]; warnings: string[] }> {
  const out: WalkItem[] = [];
  const warnings: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const { dir, depth } = item;
    if (depth > 8) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= limits.maxFiles) {
        warnings.push(`maxFiles reached (${limits.maxFiles})`);
        return { items: out, warnings };
      }
      const full = join(dir, entry.name);
      const st = await lstat(full).catch(() => null);
      if (st?.isSymbolicLink()) {
        out.push({ fullPath: full, relPath: full.replace(`${root}/`, ''), kind: 'symlink' });
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        out.push({ fullPath: full, relPath: full.replace(`${root}/`, ''), kind: 'file' });
      }
    }
  }
  return { items: out, warnings };
}

async function buildBundleFromDir(path: string, limits: IngestLimits): Promise<SkillBundle> {
  const files: SkillBundle['files'] = [];
  const manifest: SkillManifestEntry[] = [];
  const ingest_warnings: string[] = [];
  let totalBytes = 0;
  const walked = await walkDir(path, limits);
  ingest_warnings.push(...walked.warnings);

  for (const item of walked.items) {
    const rel = item.relPath;
    if (item.kind === 'symlink') {
      manifest.push({ path: rel, is_symlink: true, skipped_reason: 'symlink_skipped', source_kind: 'dir' });
      continue;
    }

    const st = await stat(item.fullPath).catch(() => null);
    const size = st?.size ?? 0;
    const mode = st?.mode ?? 0;
    const is_executable = (mode & 0o111) !== 0;
    const is_archive = isArchivePath(rel);
    const is_binary = isSuspiciousBinaryPath(rel);
    manifest.push({
      path: rel,
      size_bytes: size,
      is_executable,
      is_archive,
      is_binary,
      source_kind: 'dir',
    });

    if (!isLikelyTextPath(rel)) continue;
    if (size <= 0) continue;
    if (size > limits.maxFileBytes) {
      ingest_warnings.push(`skipped ${rel}: exceeds maxFileBytes (${limits.maxFileBytes})`);
      continue;
    }
    if (totalBytes + size > limits.maxTotalBytes) {
      ingest_warnings.push(`maxTotalBytes reached (${limits.maxTotalBytes})`);
      break;
    }
    const content = await readTextFile(item.fullPath);
    if (content === null) continue;
    totalBytes += size;
    files.push({ path: rel, content_text: content });
  }
  const entrypoint = existsSync(join(path, 'SKILL.md')) ? 'SKILL.md' : basename(path);
  return { id: basename(path), entrypoint, files, manifest, ingest_warnings, source: 'local' };
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

function buildBundleFromZipBytesInternal(bytes: Buffer, limits: IngestLimits, id: string): SkillBundle {
  const zLimits = zipLimitsFromIngest(limits);
  const listing = listZipEntriesWithDiagnostics(bytes, zLimits);
  const entries = listing.entries;
  const picked = selectZipFilesForScan(entries, zLimits);

  const files: SkillBundle['files'] = [];
  const manifest: SkillManifestEntry[] = [];

  for (const raw of listing.invalidPaths) {
    manifest.push({
      path: raw,
      skipped_reason: 'invalid_path',
      raw_path: raw,
      source_kind: 'zip',
    });
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      manifest.push({ path: entry.name, is_directory: true, source_kind: 'zip' });
      continue;
    }
    const is_symlink = zipEntryIsSymlink(entry);
    const is_executable = zipEntryIsExecutable(entry);
    const is_archive = isArchivePath(entry.name);
    const likelyText = isLikelyTextPath(entry.name);
    const is_binary = !likelyText && !isSafeBinaryAssetPath(entry.name) && isSuspiciousBinaryPath(entry.name);
    manifest.push({
      path: entry.name,
      size_bytes: entry.uncompressedSize,
      is_symlink,
      is_executable,
      is_archive,
      is_binary,
      source_kind: 'zip',
    });
  }

  for (const entry of picked) {
    if (!isLikelyTextPath(entry.name)) continue;
    const contentBytes = extractZipEntry(bytes, entry, zLimits);
    if (!contentBytes) continue;
    if (looksBinary(contentBytes)) continue;
    files.push({ path: entry.name, content_text: decodeUtf8(contentBytes) });
  }

  const entrypoint = files.some((f) => f.path.toLowerCase() === 'skill.md') ? 'SKILL.md' : 'SKILL.md';
  return { id, entrypoint, files, manifest, source: 'unknown' };
}

export function buildSkillBundleFromZipBytes(bytes: Buffer, id: string, limits: Partial<IngestLimits> = {}): SkillBundle {
  const merged: IngestLimits = { ...DEFAULT_INGEST_LIMITS, ...limits };
  if (bytes.length > merged.maxZipBytes) throw new Error(`zip exceeds maxZipBytes=${merged.maxZipBytes}`);
  return buildBundleFromZipBytesInternal(bytes, merged, id);
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
      return buildBundleFromZipBytesInternal(bytes, merged, id);
    }
    return buildBundleFromDir(spec.path, merged);
  }

  if (spec.kind === 'file') {
    const bytes = await readFile(spec.path);
    if (bytes.length > merged.maxZipBytes) throw new Error(`file exceeds maxZipBytes=${merged.maxZipBytes}`);
    const id = basename(spec.path);
    return buildBundleFromZipBytesInternal(bytes, merged, id);
  }

  const { bytes, contentType } = await fetchBytesLimited(spec.url, { timeoutMs: merged.timeoutMs, maxBytes: merged.maxZipBytes, retries: merged.retries });
  if (isZipBytes(bytes, contentType)) {
    return buildBundleFromZipBytesInternal(bytes, merged, spec.url);
  }
  if (looksBinary(bytes)) throw new Error('remote content looks binary (expected SKILL.md or zip)');
  return {
    id: spec.url,
    entrypoint: 'SKILL.md',
    files: [{ path: 'SKILL.md', content_text: decodeUtf8(bytes) }],
    source: 'unknown',
  };
}

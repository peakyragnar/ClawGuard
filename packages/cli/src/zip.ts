import { inflateRawSync } from 'node:zlib';

export type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  externalAttrs: number;
  isDirectory: boolean;
  rawName?: string;
};

export type ZipLimits = {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryBytes: number;
};

function u16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off);
}
function u32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off);
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD signature 0x06054b50
  const sig = 0x06054b50;
  const maxComment = 0xffff;
  const start = Math.max(0, buf.length - (22 + maxComment));
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === sig) return i;
  }
  return -1;
}

function isSymlinkExternalAttrs(externalAttrs: number): boolean {
  // Upper 16 bits: unix mode if created on unix.
  const mode = (externalAttrs >>> 16) & 0xffff;
  const type = mode & 0o170000;
  return type === 0o120000;
}

function isExecutableExternalAttrs(externalAttrs: number): boolean {
  const mode = (externalAttrs >>> 16) & 0xffff;
  return (mode & 0o111) !== 0;
}

function sanitizeZipPath(name: string): string | null {
  if (!name) return null;
  if (name.includes('\u0000')) return null;
  if (name.startsWith('/') || name.startsWith('\\')) return null;
  const parts = name.split('/').filter((p) => p.length > 0);
  for (const p of parts) {
    if (p === '.' || p === '..') return null;
  }
  return parts.join('/');
}

export type ZipListDiagnostics = {
  entries: ZipEntry[];
  invalidPaths: string[];
};

export function listZipEntries(buf: Buffer, limits: ZipLimits): ZipEntry[] {
  return listZipEntriesWithDiagnostics(buf, limits).entries;
}

export function listZipEntriesWithDiagnostics(buf: Buffer, limits: ZipLimits): ZipListDiagnostics {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('invalid zip: missing EOCD');

  const totalEntries = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);

  if (totalEntries > limits.maxEntries) throw new Error(`zip exceeds maxEntries=${limits.maxEntries}`);
  if (cdOffset + cdSize > buf.length) throw new Error('invalid zip: central directory out of bounds');

  const entries: ZipEntry[] = [];
  const invalidPaths: string[] = [];
  let off = cdOffset;
  const cdSig = 0x02014b50;
  for (let i = 0; i < totalEntries; i += 1) {
    if (off + 46 > buf.length) throw new Error('invalid zip: truncated central directory');
    if (buf.readUInt32LE(off) !== cdSig) throw new Error('invalid zip: bad central dir signature');
    const compressionMethod = u16(buf, off + 10);
    const compressedSize = u32(buf, off + 20);
    const uncompressedSize = u32(buf, off + 24);
    const fileNameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const externalAttrs = u32(buf, off + 38);
    const localHeaderOffset = u32(buf, off + 42);
    const nameRaw = buf.subarray(off + 46, off + 46 + fileNameLen).toString('utf8');
    const name = sanitizeZipPath(nameRaw);
    const isDirectory = nameRaw.endsWith('/');
    off = off + 46 + fileNameLen + extraLen + commentLen;

    if (!name) {
      invalidPaths.push(nameRaw);
      continue;
    }
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
      externalAttrs,
      isDirectory,
      rawName: nameRaw,
    });
  }
  return { entries, invalidPaths };
}

export function extractZipEntry(buf: Buffer, entry: ZipEntry, limits: ZipLimits): Buffer | null {
  if (entry.isDirectory) return null;
  if (isSymlinkExternalAttrs(entry.externalAttrs)) return null;
  if (entry.uncompressedSize > limits.maxEntryBytes) return null;

  const localSig = 0x04034b50;
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length) throw new Error('invalid zip: truncated local header');
  if (buf.readUInt32LE(off) !== localSig) throw new Error('invalid zip: bad local header signature');
  const fileNameLen = u16(buf, off + 26);
  const extraLen = u16(buf, off + 28);
  const dataOff = off + 30 + fileNameLen + extraLen;
  const dataEnd = dataOff + entry.compressedSize;
  if (dataEnd > buf.length) throw new Error('invalid zip: entry data out of bounds');

  const data = buf.subarray(dataOff, dataEnd);
  switch (entry.compressionMethod) {
    case 0: // store
      return Buffer.from(data);
    case 8: {
      const out = inflateRawSync(data, { finishFlush: 5 });
      return Buffer.from(out);
    }
    default:
      return null;
  }
}

export function selectZipFilesForScan(entries: ZipEntry[], limits: ZipLimits): ZipEntry[] {
  const picked: ZipEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    if (picked.length >= limits.maxEntries) break;
    if (entry.isDirectory) continue;
    if (entry.uncompressedSize <= 0) continue;
    if (entry.uncompressedSize > limits.maxEntryBytes) continue;
    if (total + entry.uncompressedSize > limits.maxTotalUncompressedBytes) break;
    picked.push(entry);
    total += entry.uncompressedSize;
  }
  return picked;
}

export function zipEntryIsSymlink(entry: ZipEntry): boolean {
  return isSymlinkExternalAttrs(entry.externalAttrs);
}

export function zipEntryIsExecutable(entry: ZipEntry): boolean {
  return isExecutableExternalAttrs(entry.externalAttrs);
}

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.sh', '.bash', '.zsh', '.ps1', '.py', '.js', '.mjs', '.ts', '.json', '.toml', '.yaml', '.yml']);

export function isLikelyTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  for (const ext of TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let zeros = 0;
  let weird = 0;
  for (const b of sample) {
    if (b === 0) zeros += 1;
    if (b < 9 || (b > 13 && b < 32)) weird += 1;
  }
  // Heuristic: NULs or a lot of control chars => treat as binary.
  if (zeros > 0) return true;
  return weird / sample.length > 0.2;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}


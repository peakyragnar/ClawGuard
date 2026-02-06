export type IngestLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxZipBytes: number;
  maxZipEntryBytes: number;
  timeoutMs: number;
  retries: number;
};

export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  maxFiles: 200,
  maxTotalBytes: 5_000_000,
  maxFileBytes: 1_000_000,
  maxZipBytes: 25_000_000,
  maxZipEntryBytes: 1_000_000,
  timeoutMs: 12_000,
  retries: 2,
};

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}


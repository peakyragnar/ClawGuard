import { setTimeout as sleep } from 'node:timers/promises';

export type ClawhubScanLimits = {
  maxSkills: number;
  maxListResponseBytes: number;
  maxSkillMdBytes: number;
  timeoutMs: number;
  retries: number;
  concurrency: number;
};

export type ClawhubSkillListEntry = {
  skill: {
    _id?: string;
    slug?: string;
    displayName?: string;
    ownerUserId?: string | number;
    summary?: string | null;
  };
  latestVersion: {
    _id: string;
    version?: string | null;
    files?: Array<{ path?: string; size?: number }>;
  };
  ownerHandle?: string | null;
};

export type ClawhubPage = {
  page: ClawhubSkillListEntry[];
  isDone: boolean;
  continueCursor: string | null;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function jitterMs(baseMs: number): number {
  const half = Math.max(1, Math.floor(baseMs / 2));
  return half + Math.floor(Math.random() * half);
}

async function fetchJsonLimited(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; maxBytes: number },
): Promise<{ status: number; ok: boolean; json: JsonValue }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = res.body;
    if (!body) {
      return { status: res.status, ok: res.ok, json: null };
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        controller.abort(new Error('max_bytes_exceeded'));
        throw new Error(`response exceeds maxBytes=${opts.maxBytes}`);
      }
      chunks.push(value);
    }

    const buf = Buffer.concat(chunks);
    const text = buf.toString('utf8');
    const parsed = JSON.parse(text) as JsonValue;
    return { status: res.status, ok: res.ok, json: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetries<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      const backoff = jitterMs(250 * 2 ** attempt);
      attempt += 1;
      await sleep(backoff);
    }
  }
}

function parseClawhubPage(value: unknown): ClawhubPage {
  const v = value as any;
  const page = Array.isArray(v?.page) ? v.page : [];
  const isDone = Boolean(v?.isDone);
  const continueCursor = typeof v?.continueCursor === 'string' ? v.continueCursor : null;
  return {
    page: page as ClawhubSkillListEntry[],
    isDone,
    continueCursor,
  };
}

function assertConvexEnvelope(json: JsonValue): { status: 'success' | 'error'; value?: any; errorMessage?: string } {
  const obj = json as any;
  if (!obj || typeof obj !== 'object') throw new Error('invalid response: expected object');
  if (obj.status !== 'success' && obj.status !== 'error') throw new Error('invalid response: missing status');
  return obj;
}

export type ClawhubClient = {
  baseUrl: string;
  query: <T>(path: string, args: Record<string, unknown>) => Promise<T>;
  action: <T>(path: string, args: Record<string, unknown>) => Promise<T>;
};

export function createClawhubClient(params: { baseUrl: string; limits: ClawhubScanLimits }): ClawhubClient {
  const baseUrl = params.baseUrl.replace(/\/+$/, '');
  const { limits } = params;
  const commonHeaders = { 'Content-Type': 'application/json', 'Convex-Client': 'clawguard' } as const;

  async function doQuery<T>(path: string, args: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify({ path, format: 'convex_encoded_json', args: [args] });
    const url = `${baseUrl}/api/query`;
    const res = await withRetries(
      () =>
        fetchJsonLimited(
          url,
          { method: 'POST', headers: commonHeaders, body },
          { timeoutMs: limits.timeoutMs, maxBytes: limits.maxListResponseBytes },
        ),
      limits.retries,
    );
    const env = assertConvexEnvelope(res.json);
    if (env.status === 'error') throw new Error(env.errorMessage ?? `query failed (${path})`);
    return env.value as T;
  }

  async function doAction<T>(path: string, args: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify({ path, format: 'convex_encoded_json', args: [args] });
    const url = `${baseUrl}/api/action`;
    const res = await withRetries(
      () =>
        fetchJsonLimited(
          url,
          { method: 'POST', headers: commonHeaders, body },
          { timeoutMs: limits.timeoutMs, maxBytes: limits.maxSkillMdBytes + 4096 },
        ),
      limits.retries,
    );
    const env = assertConvexEnvelope(res.json);
    if (env.status === 'error') throw new Error(env.errorMessage ?? `action failed (${path})`);
    return env.value as T;
  }

  return { baseUrl, query: doQuery, action: doAction };
}

export async function listSkills(client: ClawhubClient, limit: number): Promise<ClawhubSkillListEntry[]> {
  const out: ClawhubSkillListEntry[] = [];
  let cursor: string | null = null;
  let safetyPages = 0;

  while (out.length < limit) {
    safetyPages += 1;
    if (safetyPages > 50) break;
    const value = await client.query<any>('skills:listPublicPageV2', { paginationOpts: { numItems: Math.min(100, limit - out.length), cursor } });
    const parsed = parseClawhubPage(value);
    for (const entry of parsed.page) {
      if (out.length >= limit) break;
      if (!entry?.latestVersion?._id) continue;
      out.push(entry);
    }
    if (parsed.isDone) break;
    cursor = parsed.continueCursor;
    if (!cursor) break;
  }
  return out;
}

export async function fetchSkillReadme(
  client: ClawhubClient,
  versionId: string,
): Promise<{ path: string; text: string }> {
  const value = await client.action<any>('skills:getReadme', { versionId });
  const path = typeof value?.path === 'string' ? value.path : 'SKILL.md';
  const text = typeof value?.text === 'string' ? value.text : '';
  return { path, text };
}


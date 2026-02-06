import { setTimeout as sleep } from 'node:timers/promises';

type FetchLimits = {
  timeoutMs: number;
  maxBytes: number;
  retries: number;
};

function jitterMs(baseMs: number): number {
  const half = Math.max(1, Math.floor(baseMs / 2));
  return half + Math.floor(Math.random() * half);
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

export async function fetchBytesLimited(url: string, limits: FetchLimits): Promise<{ bytes: Buffer; contentType: string | null }> {
  return withRetries(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), limits.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const contentType = res.headers.get('content-type');
      const body = res.body;
      if (!body) return { bytes: Buffer.alloc(0), contentType };

      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > limits.maxBytes) throw new Error(`response exceeds maxBytes=${limits.maxBytes}`);
        chunks.push(value);
      }
      return { bytes: Buffer.concat(chunks), contentType };
    } finally {
      clearTimeout(timeout);
    }
  }, limits.retries);
}


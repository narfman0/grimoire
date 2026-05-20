interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

function maybeCleanup() {
  if (store.size > 10_000) {
    const now = Date.now();
    for (const [key, bucket] of store) {
      if (now >= bucket.resetAt) store.delete(key);
    }
  }
}

export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  maybeCleanup();
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (bucket.count >= max) return true;
  bucket.count++;
  return false;
}

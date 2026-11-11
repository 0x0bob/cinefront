import type { KV } from "./store";

/** fixed-window rate limit per key; returns {ok:false, retryAfter} once `limit` is exceeded inside the window */
export async function rateLimit(kv: KV, key: string, limit: number, windowSec: number): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const n = await kv.incr(`rl:${key}`, windowSec);
  return n > limit ? { ok: false, retryAfter: windowSec } : { ok: true };
}

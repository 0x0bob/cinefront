// Key-value store behind one small interface. Production: Upstash Redis (Vercel Marketplace "Upstash Redis", env KV_REST_API_URL/KV_REST_API_TOKEN).
// Local/dev/tests: an in-memory store, optionally persisted to web/.local-store/kv.json (STORE_DRIVER=local|memory). Nothing else in the app talks to Redis.
import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { cfg } from "./config";

export interface KV {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<boolean>;
  del(key: string): Promise<void>;
  /** INCR; the expiry is set when the key is created (fixed window) */
  incr(key: string, ex?: number): Promise<number>;
  incrByFloat(key: string, by: number, ex?: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  /** members by ascending score (rev = descending); `limit` = at most that many */
  zrange(key: string, rev?: boolean, limit?: number): Promise<string[]>;
}

type Entry = { v: unknown; exp?: number };

export class MemoryKV implements KV {
  protected data = new Map<string, Entry>();
  protected z = new Map<string, Map<string, number>>();
  protected save() {}
  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e && e.exp !== undefined && e.exp <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }
  async get<T>(key: string) { const e = this.live(key); return e ? (structuredClone(e.v) as T) : null; }
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
    if (opts?.nx && this.live(key)) return false;
    this.data.set(key, { v: structuredClone(value), exp: opts?.ex ? Date.now() + opts.ex * 1000 : undefined });
    this.save();
    return true;
  }
  async del(key: string) { this.data.delete(key); this.save(); }
  async incr(key: string, ex?: number) {
    const e = this.live(key);
    const n = (typeof e?.v === "number" ? e.v : 0) + 1;
    this.data.set(key, { v: n, exp: e ? e.exp : ex ? Date.now() + ex * 1000 : undefined });
    this.save();
    return n;
  }
  async incrByFloat(key: string, by: number, ex?: number) {
    const e = this.live(key);
    const n = Math.round(((typeof e?.v === "number" ? e.v : 0) + by) * 1e6) / 1e6;
    this.data.set(key, { v: n, exp: e ? e.exp : ex ? Date.now() + ex * 1000 : undefined });
    this.save();
    return n;
  }
  async zadd(key: string, score: number, member: string) {
    if (!this.z.has(key)) this.z.set(key, new Map());
    this.z.get(key)!.set(member, score);
    this.save();
  }
  async zrem(key: string, member: string) { this.z.get(key)?.delete(member); this.save(); }
  async zrange(key: string, rev = false, limit?: number) {
    const m = this.z.get(key);
    if (!m) return [];
    const out = [...m.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const ordered = rev ? out.reverse() : out;
    return limit ? ordered.slice(0, limit) : ordered;
  }
}

export class FileKV extends MemoryKV {
  constructor(private file: string) {
    super();
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      this.data = new Map(Object.entries(raw.data ?? {}));
      this.z = new Map(Object.entries(raw.z ?? {}).map(([k, v]) => [k, new Map(Object.entries(v as Record<string, number>))]));
    } catch { /* first run */ }
  }
  protected save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const raw = { data: Object.fromEntries(this.data), z: Object.fromEntries([...this.z].map(([k, v]) => [k, Object.fromEntries(v)])) };
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(raw));
    fs.renameSync(tmp, this.file);
  }
}

export class UpstashKV implements KV {
  constructor(private r: Redis) {}
  async get<T>(key: string) { return (await this.r.get<T>(key)) ?? null; }
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
    const res = await this.r.set(key, value as never, { ...(opts?.nx ? { nx: true as const } : {}), ...(opts?.ex ? { ex: opts.ex } : {}) } as never);
    return res === "OK";
  }
  async del(key: string) { await this.r.del(key); }
  async incr(key: string, ex?: number) {
    const n = await this.r.incr(key);
    if (n === 1 && ex) await this.r.expire(key, ex);
    return n;
  }
  async incrByFloat(key: string, by: number, ex?: number) {
    const n = await this.r.incrbyfloat(key, by);
    if (ex) await this.r.expire(key, ex);
    return Number(n);
  }
  async zadd(key: string, score: number, member: string) { await this.r.zadd(key, { score, member }); }
  async zrem(key: string, member: string) { await this.r.zrem(key, member); }
  async zrange(key: string, rev = false, limit?: number) { return (await this.r.zrange<string[]>(key, 0, limit ? limit - 1 : -1, rev ? { rev: true } : undefined)) as string[]; }
}

const g = globalThis as unknown as { __kv?: KV };

/** value of the env var named exactly one of `names`, else of the first var whose name ends with `_<name>` (a prefixed integration) */
export function envEnding(...names: string[]): string | undefined {
  for (const n of names) if (process.env[n]) return process.env[n];
  for (const n of names) {
    const k = Object.keys(process.env).sort().find((key) => key.endsWith("_" + n) && process.env[key]);
    if (k) return process.env[k];
  }
  return undefined;
}

export function getKV(): KV {
  if (g.__kv) return g.__kv;
  const c = cfg();
  if (c.storeDriver === "memory") g.__kv = new MemoryKV();
  else if (c.storeDriver === "local") g.__kv = new FileKV(path.join(process.cwd(), ".local-store", "kv.json"));
  else {
    // the Marketplace integration may add a prefix to the names (e.g. STORAGE_KV_REST_API_URL): accept any name that ends with the standard one
    const url = envEnding("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL");
    const token = envEnding("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
    if (!url || !token) {
      // names only (never values) of the storage-related variables this deployment sees, plus where it runs: enough to debug a missing connection from outside
      const seen = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH|BLOB/.test(k)).sort().join(",") || "none";
      throw new Error(`no store configured: connect Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) or set STORE_DRIVER=local for development [env=${process.env.VERCEL_ENV ?? "?"} commit=${(process.env.VERCEL_GIT_COMMIT_SHA ?? "?").slice(0, 7)} sees: ${seen}]`);
    }
    g.__kv = new UpstashKV(new Redis({ url, token }));
  }
  return g.__kv;
}

/** tests inject a fresh store */
export function setKV(kv: KV | undefined) { g.__kv = kv; }

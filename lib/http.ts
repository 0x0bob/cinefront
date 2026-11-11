import { createHash } from "node:crypto";
import { cfg } from "./config";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export const fail = (status: number, error: string, headers: Record<string, string> = {}) => json({ error }, status, headers);

export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return { ok: false, res: fail(413, "request too large") };
  const text = await req.text();
  if (text.length > maxBytes) return { ok: false, res: fail(413, "request too large") };
  try {
    const body = JSON.parse(text || "{}");
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, res: fail(400, "invalid JSON") };
  }
}

/** client IP: on Vercel x-forwarded-for is set by the platform; the first entry is the client */
export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf ? xf.split(",")[0].trim() : req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

/** IPs are only ever stored (and used as rate-limit keys) as a salted hash */
export function ipHash(ip: string): string {
  return createHash("sha256").update(cfg().ipSalt + "|" + ip).digest("hex").slice(0, 16);
}

/** state-changing browser requests must come from our own origin (the admin cookie is SameSite=Strict as well) */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;                      // non-browser clients (curl, tests) send no Origin; they still need the cookie / secret
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "");
  } catch {
    return false;
  }
}

/** wrap a route handler: a missing / unreachable store -> 503 with a clear message; anything else -> 500 without details (logged on the server) */
export function safe<A extends unknown[]>(fn: (...a: A) => Promise<Response>): (...a: A) => Promise<Response> {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("handler error:", msg);
      if (msg.startsWith("no store configured")) return fail(503, "the store is not connected yet: the site owner must connect Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN)");
      return fail(500, "internal error");
    }
  };
}

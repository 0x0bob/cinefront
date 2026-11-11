import { createHmac, timingSafeEqual } from "node:crypto";
import { cfg } from "./config";

export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function workerAuthorized(req: Request): boolean {
  const c = cfg();
  const got = req.headers.get("x-worker-secret") ?? "";
  return c.workerSecret.length >= 32 && got.length > 0 && safeEqual(got, c.workerSecret);
}

// ---- admin session: cookie "ss_admin" = <expiry ms>.<hmac(expiry)>, httpOnly, SameSite=Strict, no server-side session store needed ----
const COOKIE = "ss_admin";
const TTL_MS = 8 * 3600 * 1000;
const sign = (exp: string) => createHmac("sha256", cfg().sessionSecret + "|" + cfg().adminPassword).update("admin|" + exp).digest("hex");

export function adminCookie(secure: boolean): string {
  const exp = String(Date.now() + TTL_MS);
  return `${COOKIE}=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}
export const clearCookie = (secure: boolean) => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;

export function adminAuthorized(req: Request): boolean {
  const c = cfg();
  if (c.adminPassword.length < 8 || c.sessionSecret.length < 32) return false;
  const m = (req.headers.get("cookie") ?? "").split(/;\s*/).find((p) => p.startsWith(COOKIE + "="));
  if (!m) return false;
  const [exp, mac] = m.slice(COOKIE.length + 1).split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  return safeEqual(mac, sign(exp));
}

export function isSecure(req: Request): boolean {
  return (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
}

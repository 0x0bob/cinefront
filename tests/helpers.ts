import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach } from "vitest";
import { MemoryKV, setKV } from "@/lib/store";

export const PASSCODE = "open-sesame";
export const ADMIN_PW = "admin-password-1";
export const WORKER = "w".repeat(40);
export const BASE = "http://localhost:3000";

export function useEnv(over: Record<string, string> = {}) {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-web-"));
    process.chdir(tmp);                                              // the local blob driver writes under cwd/.local-blob
    Object.assign(process.env, {
      REQUEST_PASSCODE: PASSCODE, ADMIN_PASSWORD: ADMIN_PW, SESSION_SECRET: "s".repeat(40), WORKER_SECRET: WORKER, IP_HASH_SALT: "salt",
      DAILY_CAP_USD: "5", MAX_COST_PER_SCENE_USD: "2", PRICE_PER_MTOKEN_USD: "10.7", REQUESTS_PER_HOUR_PER_IP: "3", BLOB_DRIVER: "local", PUBLIC_BASE_URL: BASE, STALE_JOB_MINUTES: "60", ...over,
    });
    delete process.env.STORE_DRIVER;
    setKV(new MemoryKV());
  });
}

export const post = (path_: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(BASE + path_, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers }, body: JSON.stringify(body) });
export const get = (path_: string, headers: Record<string, string> = {}) => new Request(BASE + path_, { headers });
export const workerHdr = { "x-worker-secret": WORKER };

export async function adminCookieHeader(): Promise<Record<string, string>> {
  const { adminLogin } = await import("@/lib/handlers");
  const res = await adminLogin(post("/api/admin/login", { password: ADMIN_PW }));
  const sc = res.headers.get("set-cookie")!;
  return { cookie: sc.split(";")[0] };
}

export const GOOD = { prompt: "a herd of woolly mammoths walks slowly through a snowy valley at sunset", preset: "static", duration: 5, resolution: "720p", passcode: PASSCODE };

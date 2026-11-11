// Configuration: environment variables only, read at call time (tests change process.env). No defaults for secrets.
const num = (v: string | undefined, d: number) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export function cfg() {
  const e = process.env;
  return {
    requestPasscode: e.REQUEST_PASSCODE ?? "",
    adminPassword: e.ADMIN_PASSWORD ?? "",
    sessionSecret: e.SESSION_SECRET ?? "",
    workerSecret: e.WORKER_SECRET ?? "",
    ipSalt: e.IP_HASH_SALT ?? "",
    dailyCapUsd: num(e.DAILY_CAP_USD, 5),
    maxCostPerSceneUsd: num(e.MAX_COST_PER_SCENE_USD, 2),
    pricePerMtoken: num(e.PRICE_PER_MTOKEN_USD, 10.7),
    requestsPerHourPerIp: num(e.REQUESTS_PER_HOUR_PER_IP, 5),
    storeDriver: (e.STORE_DRIVER ?? "") as "" | "local" | "memory",
    blobDriver: (e.BLOB_DRIVER ?? "") as "" | "local",
    baseUrl: e.PUBLIC_BASE_URL ?? "",
    isProd: e.NODE_ENV === "production" && !e.STORE_DRIVER,
    staleMinutes: num(e.STALE_JOB_MINUTES, 60),
  };
}

export type Cfg = ReturnType<typeof cfg>;

/** names of required settings that are missing or too weak; the handlers answer 503 instead of running half-configured */
export function missing(keys: (keyof Cfg)[]): string[] {
  const c = cfg();
  const weak: string[] = [];
  for (const k of keys) {
    const v = c[k];
    if (typeof v === "string" && v.length === 0) weak.push(k);
    if ((k === "sessionSecret" || k === "workerSecret") && typeof v === "string" && v.length > 0 && v.length < 32) weak.push(k + " (needs >= 32 chars)");
  }
  return weak;
}

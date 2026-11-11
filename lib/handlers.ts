// Route logic as plain (Request) => Response functions: the route files are one-line wrappers, the unit tests call these directly.
import fs from "node:fs";
import path from "node:path";
import { adminAuthorized, adminCookie, clearCookie, isSecure, safeEqual, workerAuthorized } from "./auth";
import { acceptableAssetUrl, ALLOWED, LOCAL_ROOT, makeUploadTarget, verifyLocalSig, writeLocal } from "./blob";
import { cfg, missing } from "./config";
import { DURATIONS, RESOLUTIONS, type Resolution } from "./cost";
import { checkPrompt } from "./filter";
import { clientIp, fail, ipHash, json, readJson, safe, sameOrigin } from "./http";
import { adminView, allJobs, approve, claim, createJob, getJob, isPublished, jobStatusView, PRESETS, publicScene, reject, release, setPublic, spentToday, sweepStale, workerUpdate, STATUSES, type Preset } from "./jobs";
import { rateLimit } from "./rate";
import { getKV } from "./store";

const notConfigured = (what: string[]) => fail(503, "the server is not configured: " + what.join(", "));
const MAX_PENDING = 25;

// ---------------------------------------------------------------- public: request a scene
async function submitRequestRaw(req: Request): Promise<Response> {
  const bad = missing(["requestPasscode", "ipSalt"]);
  if (bad.length) return notConfigured(bad);
  if (!sameOrigin(req)) return fail(403, "bad origin");
  const kv = getKV();
  const c = cfg();
  const ih = ipHash(clientIp(req));
  const rl = await rateLimit(kv, `req:${ih}`, c.requestsPerHourPerIp, 3600);
  if (!rl.ok) return fail(429, "too many requests from your network, try again later", { "retry-after": String(rl.retryAfter) });
  const r = await readJson(req, 4096);
  if (!r.ok) return r.res;
  const { body } = r;
  const pc = typeof body.passcode === "string" ? body.passcode : "";
  if (!safeEqual(pc, c.requestPasscode)) {
    const bl = await rateLimit(kv, `pc:${ih}`, 10, 3600);                    // wrong passcodes are limited harder
    return bl.ok ? fail(403, "wrong passcode") : fail(429, "too many wrong passcodes", { "retry-after": "3600" });
  }
  const chk = checkPrompt(body.prompt);
  if (!chk.ok) return fail(400, chk.error);
  const preset = body.preset === undefined ? "static" : (PRESETS as readonly unknown[]).includes(body.preset) ? (body.preset as Preset) : null;
  if (!preset) return fail(400, `preset must be one of ${PRESETS.join(", ")}`);
  const duration = body.duration === undefined ? 5 : Number(body.duration);
  const resolution = (body.resolution === undefined ? "720p" : body.resolution) as Resolution;
  if (!(DURATIONS as readonly number[]).includes(duration)) return fail(400, `duration must be one of ${DURATIONS.join(", ")}`);
  if (!(RESOLUTIONS as readonly string[]).includes(resolution)) return fail(400, `resolution must be one of ${RESOLUTIONS.join(", ")}`);
  const pending = (await allJobs(kv)).filter((j) => j.status === "pending_approval").length;
  if (pending >= MAX_PENDING) return fail(429, "too many requests are waiting for approval, try again later");
  const j = await createJob(kv, { prompt: chk.prompt, preset, duration, resolution, ipHash: ih });
  return json({ id: j.id, status: j.status, needs_approval: true, estimated_cost_usd: j.estimated_cost_usd, estimated_tokens: j.estimated_tokens, url: `/jobs/${j.id}` }, 201);
}

async function jobStatusRaw(_req: Request, id: string): Promise<Response> {
  const j = await getJob(getKV(), id);
  return j ? json(jobStatusView(j)) : fail(404, "not found");
}

// ---------------------------------------------------------------- public: gallery data (published scenes only; allowlisted fields)
async function publicListRaw(): Promise<Response> {
  const jobs = (await allJobs(getKV())).filter(isPublished).sort((a, b) => (b.published_utc ?? "").localeCompare(a.published_utc ?? ""));
  return json(jobs.map(publicScene), 200, { "cache-control": "public, max-age=30" });
}
async function publicDetailRaw(_req: Request, id: string): Promise<Response> {
  const j = await getJob(getKV(), id);
  return isPublished(j) ? json(publicScene(j), 200, { "cache-control": "public, max-age=30" }) : fail(404, "not found");       // private, unknown and malformed ids: the same 404
}

// ---------------------------------------------------------------- admin
async function adminLoginRaw(req: Request): Promise<Response> {
  const bad = missing(["adminPassword", "sessionSecret", "ipSalt"]);
  if (bad.length) return notConfigured(bad);
  if (!sameOrigin(req)) return fail(403, "bad origin");
  const kv = getKV();
  const rl = await rateLimit(kv, `login:${ipHash(clientIp(req))}`, 10, 900);
  if (!rl.ok) return fail(429, "too many attempts", { "retry-after": String(rl.retryAfter) });
  const r = await readJson(req, 1024);
  if (!r.ok) return r.res;
  const pw = typeof r.body.password === "string" ? r.body.password : "";
  if (!safeEqual(pw, cfg().adminPassword)) return fail(401, "wrong password");
  return json({ ok: true }, 200, { "set-cookie": adminCookie(isSecure(req)) });
}
async function adminLogoutRaw(req: Request): Promise<Response> {
  return json({ ok: true }, 200, { "set-cookie": clearCookie(isSecure(req)) });
}

async function adminListRaw(req: Request): Promise<Response> {
  if (!adminAuthorized(req)) return fail(401, "login required");
  const kv = getKV();
  await sweepStale(kv);
  const jobs = await allJobs(kv);
  const c = cfg();
  return json({ jobs: jobs.map(adminView), spend: { today_usd: await spentToday(kv), daily_cap_usd: c.dailyCapUsd, max_cost_per_scene_usd: c.maxCostPerSceneUsd } });
}

async function adminActionRaw(req: Request, id: string, action: string): Promise<Response> {
  if (!adminAuthorized(req)) return fail(401, "login required");
  if (!sameOrigin(req)) return fail(403, "bad origin");
  const kv = getKV();
  const r = await readJson(req, 2048);
  if (!r.ok) return r.res;
  let res;
  if (action === "approve") res = await approve(kv, id);
  else if (action === "reject") res = await reject(kv, id, typeof r.body.reason === "string" ? r.body.reason : undefined);
  else if (action === "release") res = await release(kv, id);
  else if (action === "publish") res = await setPublic(kv, id, true, typeof r.body.title === "string" ? r.body.title : undefined);
  else if (action === "unpublish") res = await setPublic(kv, id, false);
  else return fail(404, "unknown action");
  return res.ok ? json(adminView(res.value)) : fail(res.status, res.error);
}

// ---------------------------------------------------------------- PC worker (pull model: the PC calls us, nothing calls the PC)
function workerGate(req: Request): Response | null {
  const bad = missing(["workerSecret"]);
  if (bad.length) return notConfigured(bad);
  return workerAuthorized(req) ? null : fail(401, "bad worker secret");
}

async function workerClaimRaw(req: Request): Promise<Response> {
  const g = workerGate(req);
  if (g) return g;
  const r = await readJson(req, 1024);
  if (!r.ok) return r.res;
  const out = await claim(getKV(), typeof r.body.worker === "string" ? r.body.worker : "pc");
  return json(out);
}

async function workerUpdateRouteRaw(req: Request): Promise<Response> {
  const g = workerGate(req);
  if (g) return g;
  const r = await readJson(req, 16 * 1024);
  if (!r.ok) return r.res;
  const res = await workerUpdate(getKV(), r.body, new URL(req.url).origin, acceptableAssetUrl);
  return res.ok ? json({ ok: true, status: res.value.status }) : fail(res.status, res.error);
}

async function workerUploadUrlRaw(req: Request): Promise<Response> {
  const g = workerGate(req);
  if (g) return g;
  const r = await readJson(req, 2048);
  if (!r.ok) return r.res;
  const id = String(r.body.id ?? "");
  const filename = String(r.body.filename ?? "");
  const size = Number(r.body.size ?? 0);
  const j = await getJob(getKV(), id);
  if (!j) return fail(404, "no such job");
  if (j.status !== "generating" && j.status !== "processing") return fail(409, `job is '${j.status}'`);
  const spec = ALLOWED[filename];
  if (!spec) return fail(400, "file not allowed");
  if (!(size > 0 && size <= spec.maxBytes)) return fail(413, `size must be 1..${spec.maxBytes} bytes`);
  try {
    return json(await makeUploadTarget(id, filename, new URL(req.url).origin));
  } catch (e) {
    return fail(503, e instanceof Error ? e.message : "upload target unavailable");
  }
}

// ---------------------------------------------------------------- local blob driver (dev/tests only): signed PUT, public GET with Range
async function blobPutRaw(req: Request, parts: string[]): Promise<Response> {
  if (cfg().blobDriver !== "local") return fail(404, "not found");
  const pathname = parts.join("/");
  const u = new URL(req.url);
  const m = /^scenes\/([0-9a-f]{24})\/([a-z0-9_.]+)$/.exec(pathname);
  if (!m || !ALLOWED[m[2]]) return fail(404, "not found");
  if (!verifyLocalSig(pathname, Number(u.searchParams.get("exp")), u.searchParams.get("sig") ?? "")) return fail(403, "bad signature");
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0 || data.length > ALLOWED[m[2]].maxBytes) return fail(413, "bad size");
  writeLocal(pathname, data);
  return json({ url: `${(cfg().baseUrl || u.origin).replace(/\/$/, "")}/api/blob/${pathname}`, pathname, contentType: ALLOWED[m[2]].type });
}

async function blobGetRaw(req: Request, parts: string[]): Promise<Response> {
  if (cfg().blobDriver !== "local") return fail(404, "not found");
  const pathname = parts.join("/");
  const m = /^scenes\/([0-9a-f]{24})\/([a-z0-9_.]+)$/.exec(pathname);
  if (!m || !ALLOWED[m[2]]) return fail(404, "not found");
  const j = await getJob(getKV(), m[1]);
  if (!isPublished(j) && m[2] !== "poster.jpg") {
    // unpublished scenes: only the owner-facing poster is served; everything else 404s (same as a missing file)
    return fail(404, "not found");
  }
  const p = path.join(LOCAL_ROOT(), pathname);
  if (!fs.existsSync(p)) return fail(404, "not found");
  const size = fs.statSync(p).size;
  const type = ALLOWED[m[2]].type;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "public, max-age=60", "cross-origin-resource-policy": "same-origin" };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    if (start >= size || end < start) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    end = Math.min(end, size - 1);
    start = Math.max(start, 0);
    const buf = Buffer.alloc(end - start + 1);
    const fd = fs.openSync(p, "r");
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return new Response(buf, { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(buf.length) } });
  }
  return new Response(fs.readFileSync(p), { status: 200, headers: { ...base, "content-length": String(size) } });
}

export { STATUSES };

// every handler is wrapped: a missing or unreachable store answers 503 with a clear message instead of a bare 500
export const submitRequest = safe(submitRequestRaw);
export const jobStatus = safe(jobStatusRaw);
export const publicList = safe(publicListRaw);
export const publicDetail = safe(publicDetailRaw);
export const adminLogin = safe(adminLoginRaw);
export const adminLogout = safe(adminLogoutRaw);
export const adminList = safe(adminListRaw);
export const adminAction = safe(adminActionRaw);
export const workerClaim = safe(workerClaimRaw);
export const workerUpdateRoute = safe(workerUpdateRouteRaw);
export const workerUploadUrl = safe(workerUploadUrlRaw);
export const blobPut = safe(blobPutRaw);
export const blobGet = safe(blobGetRaw);

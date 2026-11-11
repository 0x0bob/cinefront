// Job logic (storage-agnostic apart from the KV interface): create, approve/reject, claim (pull model), worker updates, publish, public views.
import { randomBytes } from "node:crypto";
import { cfg } from "./config";
import { estimate, type Resolution } from "./cost";
import type { KV } from "./store";

export type Status = "pending_approval" | "queued" | "generating" | "processing" | "done" | "rejected" | "failed";
export const STATUSES: Status[] = ["pending_approval", "queued", "generating", "processing", "done", "rejected", "failed"];
export const LABEL = "180° AI video dome (3DoF)";

export interface SceneMeta {
  projection: { model: string; fov_deg: number; pitch_deg: number; circle: { cx: number; cy: number; r: number; size: number }; feather: number };
  video: { width: number; height: number; fps: number; duration_s: number; has_audio: boolean };
}
export type Assets = { dome: string; preview: string; poster: string; proof_sheet?: string };
export interface Job {
  id: string;
  prompt: string;
  preset: "static" | "ride";
  duration: number;
  resolution: Resolution;
  status: Status;
  created_utc: string;
  updated_utc: string;
  estimated_tokens: number;
  estimated_cost_usd: number;
  ip_hash: string;
  title?: string;
  progress?: { stage: string; pct: number; message?: string };
  error?: string;
  public: boolean;
  published_utc?: string;
  approved_utc?: string;
  claimed_utc?: string;
  worker?: string;
  scene?: SceneMeta;
  assets?: Assets;
  /** NEVER leaves the server: actual spend, task id, reservation */
  private?: { reserved_usd?: number; actual_cost_usd?: number; actual_tokens?: number; task_id?: string; rejected_reason?: string };
}

const jobKey = (id: string) => `job:${id}`;
export const spendKey = (d = new Date()) => `spend:${d.toISOString().slice(0, 10)}`;
export const newId = () => randomBytes(12).toString("hex");
const now = () => new Date().toISOString();

export async function getJob(kv: KV, id: string): Promise<Job | null> {
  return /^[0-9a-f]{24}$/.test(id) ? kv.get<Job>(jobKey(id)) : null;
}
async function saveJob(kv: KV, j: Job) {
  j.updated_utc = now();
  await kv.set(jobKey(j.id), j);
}
export async function allJobs(kv: KV): Promise<Job[]> {
  const ids = await kv.zrange("jobs:all", true);
  const out: Job[] = [];
  for (const id of ids) {
    const j = await kv.get<Job>(jobKey(id));
    if (j) out.push(j);
  }
  return out;
}
export async function spentToday(kv: KV): Promise<number> {
  return (await kv.get<number>(spendKey())) ?? 0;
}

export async function createJob(kv: KV, input: { prompt: string; preset: "static" | "ride"; duration: number; resolution: Resolution; ipHash: string }): Promise<Job> {
  const est = estimate(input.duration, input.resolution, cfg().pricePerMtoken);
  const j: Job = {
    id: newId(), prompt: input.prompt, preset: input.preset, duration: input.duration, resolution: input.resolution, status: "pending_approval",
    created_utc: now(), updated_utc: now(), estimated_tokens: est.tokens, estimated_cost_usd: est.costUsd, ip_hash: input.ipHash, public: false,
  };
  await kv.set(jobKey(j.id), j);
  await kv.zadd("jobs:all", Date.now(), j.id);
  return j;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** admin approval: the paid job is only queued if the per-scene and the DAILY cap allow it; the estimate is reserved against today's spend */
export async function approve(kv: KV, id: string): Promise<Result<Job>> {
  const j = await getJob(kv, id);
  if (!j) return { ok: false, status: 404, error: "no such job" };
  if (j.status !== "pending_approval") return { ok: false, status: 409, error: `job is '${j.status}', not pending approval` };
  const c = cfg();
  if (j.estimated_cost_usd > c.maxCostPerSceneUsd) return { ok: false, status: 409, error: `estimated $${j.estimated_cost_usd} exceeds the per-scene cap $${c.maxCostPerSceneUsd}` };
  const spent = await spentToday(kv);
  if (spent + j.estimated_cost_usd > c.dailyCapUsd) return { ok: false, status: 409, error: `daily cap: $${spent.toFixed(2)} already reserved today + $${j.estimated_cost_usd} > $${c.dailyCapUsd}` };
  await kv.incrByFloat(spendKey(), j.estimated_cost_usd, 3 * 86400);
  await kv.zadd("jobs:queued", Date.now(), j.id);                   // the worker only ever reads this small index: an idle poll costs ONE Redis command
  j.status = "queued";
  j.approved_utc = now();
  j.private = { ...j.private, reserved_usd: j.estimated_cost_usd };
  await saveJob(kv, j);
  return { ok: true, value: j };
}

export async function reject(kv: KV, id: string, reason?: string): Promise<Result<Job>> {
  const j = await getJob(kv, id);
  if (!j) return { ok: false, status: 404, error: "no such job" };
  if (j.status !== "pending_approval" && j.status !== "queued") return { ok: false, status: 409, error: `job is '${j.status}'` };
  if (j.status === "queued" && j.private?.reserved_usd) await kv.incrByFloat(spendKey(), -j.private.reserved_usd, 3 * 86400);       // give the reservation back
  if (j.status === "queued") await kv.zrem("jobs:queued", j.id);
  j.status = "rejected";
  j.error = "not approved";
  j.private = { ...j.private, rejected_reason: (reason ?? "").slice(0, 200) };
  await saveJob(kv, j);
  return { ok: true, value: j };
}

export type Claimed = Pick<Job, "id" | "prompt" | "preset" | "duration" | "resolution" | "estimated_cost_usd" | "estimated_tokens">;

/** jobs whose worker went silent are FAILED, never re-queued: re-running could pay for Seedance twice */
export async function sweepStale(kv: KV): Promise<number> {
  const staleMs = cfg().staleMinutes * 60 * 1000;
  let n = 0;
  for (const j of await allJobs(kv)) {
    if ((j.status === "generating" || j.status === "processing") && Date.now() - Date.parse(j.updated_utc) > staleMs) {
      j.status = "failed";
      j.error = "the worker went silent; the job was not re-run (it may already have been billed)";
      await saveJob(kv, j);
      n++;
    }
  }
  return n;
}

export type ClaimResult = { job: Claimed | null; daily_cap_usd?: number; spent_today_usd?: number; max_cost_per_scene_usd?: number };

/** the PC asks for work. An idle poll costs ONE Redis command (zrange of the queued index). Oldest approved job first; one claim per job (SET NX). */
export async function claim(kv: KV, worker: string): Promise<ClaimResult> {
  const queued = await kv.zrange("jobs:queued", false, 5);
  if (queued.length === 0) return { job: null };
  await sweepStale(kv);
  const c = cfg();
  for (const id of queued) {
    const j = await getJob(kv, id);
    if (!j || j.status !== "queued") { await kv.zrem("jobs:queued", id); continue; }
    if (!(await kv.set(`claim:${j.id}`, worker, { nx: true, ex: 30 * 86400 }))) continue;
    await kv.zrem("jobs:queued", id);
    j.status = "generating";
    j.claimed_utc = now();
    j.worker = worker.slice(0, 40);
    j.progress = { stage: "generating", pct: 0, message: "claimed by the worker" };
    await saveJob(kv, j);
    return {
      job: { id: j.id, prompt: j.prompt, preset: j.preset, duration: j.duration, resolution: j.resolution, estimated_cost_usd: j.estimated_cost_usd, estimated_tokens: j.estimated_tokens },
      daily_cap_usd: c.dailyCapUsd, spent_today_usd: await spentToday(kv), max_cost_per_scene_usd: c.maxCostPerSceneUsd,
    };
  }
  return { job: null };
}

const TRANSITIONS: Record<string, Status[]> = { generating: ["generating", "processing", "done", "failed", "rejected"], processing: ["processing", "done", "failed", "rejected"] };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

/** the worker reports progress / the result. Only allowlisted fields are copied; private numbers stay private. */
export async function workerUpdate(kv: KV, body: Record<string, unknown>, origin: string, acceptUrl: (u: unknown, id: string, f: string, origin: string) => string | null): Promise<Result<Job>> {
  const id = String(body.id ?? "");
  const j = await getJob(kv, id);
  if (!j) return { ok: false, status: 404, error: "no such job" };
  const next = (body.status ?? j.status) as Status;
  if (!STATUSES.includes(next)) return { ok: false, status: 400, error: "unknown status" };
  if (!TRANSITIONS[j.status]) return { ok: false, status: 409, error: `job is '${j.status}': no updates accepted` };
  if (!TRANSITIONS[j.status].includes(next)) return { ok: false, status: 409, error: `cannot go from '${j.status}' to '${next}'` };
  const p = body.progress as Record<string, unknown> | undefined;
  if (p && typeof p === "object") j.progress = { stage: str(p.stage, 30) ?? j.status, pct: Math.max(0, Math.min(100, num(p.pct) ?? 0)), message: str(p.message, 160) };
  if (next === "done") {
    const a = body.assets as Record<string, unknown> | undefined;
    const dome = acceptUrl(a?.dome, id, "dome.mp4", origin);
    const preview = acceptUrl(a?.preview, id, "preview.mp4", origin);
    const poster = acceptUrl(a?.poster, id, "poster.jpg", origin);
    const proof = a?.proof_sheet ? acceptUrl(a.proof_sheet, id, "proof_sheet.png", origin) : null;
    if (!dome || !preview || !poster) return { ok: false, status: 400, error: "done needs dome, preview and poster URLs inside our blob store" };
    const s = body.scene as Record<string, unknown> | undefined;
    const pr = s?.projection as Record<string, unknown> | undefined;
    const vd = s?.video as Record<string, unknown> | undefined;
    const ci = pr?.circle as Record<string, unknown> | undefined;
    if (!pr || !vd || !ci || [pr.fov_deg, pr.pitch_deg, ci.cx, ci.cy, ci.r, ci.size, vd.width, vd.height, vd.fps, vd.duration_s].some((x) => num(x) === undefined)) {
      return { ok: false, status: 400, error: "done needs scene.projection and scene.video" };
    }
    j.scene = {
      projection: { model: "equidistant", fov_deg: pr.fov_deg as number, pitch_deg: pr.pitch_deg as number, circle: { cx: ci.cx as number, cy: ci.cy as number, r: ci.r as number, size: ci.size as number }, feather: num(pr.feather) ?? 0.05 },
      video: { width: vd.width as number, height: vd.height as number, fps: vd.fps as number, duration_s: vd.duration_s as number, has_audio: vd.has_audio === true },
    };
    j.assets = { dome, preview, poster, ...(proof ? { proof_sheet: proof } : {}) };
    j.progress = { stage: "done", pct: 100 };
  }
  if (next === "failed" || next === "rejected") j.error = str(body.error, 240) ?? (next === "rejected" ? "the clip did not pass the automatic checks" : "generation failed");
  const act = body.actual as Record<string, unknown> | undefined;       // private: real tokens/cost/task id from the PC
  if (act && typeof act === "object") {
    const cost = num(act.cost_usd);
    const priv = (j.private = { ...j.private });
    if (num(act.tokens) !== undefined) priv.actual_tokens = act.tokens as number;
    if (typeof act.task_id === "string") priv.task_id = act.task_id.slice(0, 80);
    if (cost !== undefined && cost >= 0 && cost <= 50) {
      const diff = cost - (priv.actual_cost_usd ?? priv.reserved_usd ?? 0);          // settle today's spend with what the PC really spent
      priv.actual_cost_usd = cost;
      if (diff) await kv.incrByFloat(spendKey(), diff, 3 * 86400);
    }
  }
  j.status = next;
  await saveJob(kv, j);
  return { ok: true, value: j };
}

export async function setPublic(kv: KV, id: string, pub: boolean, title?: string): Promise<Result<Job>> {
  const j = await getJob(kv, id);
  if (!j) return { ok: false, status: 404, error: "no such job" };
  if (j.status !== "done") return { ok: false, status: 409, error: "only a finished scene can be published" };
  j.public = pub;
  if (pub) {
    j.published_utc = now();
    if (title) j.title = title.slice(0, 120);
  }
  await saveJob(kv, j);
  return { ok: true, value: j };
}

// ---------------- views ----------------
export const titleOf = (j: Job) => (j.title?.trim() || (j.prompt.length > 70 ? j.prompt.slice(0, 70) + "…" : j.prompt));

/** public scene JSON: an ALLOWLIST. No cost, tokens, seed, task id, worker, ip hash, history. */
export function publicScene(j: Job) {
  return {
    id: j.id, title: titleOf(j), prompt: j.prompt, created_utc: j.created_utc, published_utc: j.published_utc ?? null, label: LABEL, projection: j.scene!.projection, video: j.scene!.video,
    files: { dome: j.assets!.dome, preview: j.assets!.preview, poster: j.assets!.poster, ...(j.assets!.proof_sheet ? { proof_sheet: j.assets!.proof_sheet } : {}) },
  };
}
export const isPublished = (j: Job | null): j is Job => !!j && j.public && j.status === "done" && !!j.scene && !!j.assets;

/** what the requester sees on /jobs/{id} (the id is an unguessable 96-bit token) */
export function jobStatusView(j: Job) {
  const waiting = j.status === "pending_approval" || j.status === "queued";
  return {
    id: j.id, status: j.status, preset: j.preset, duration: j.duration, resolution: j.resolution, prompt: j.prompt, created_utc: j.created_utc, updated_utc: j.updated_utc,
    progress: j.progress ?? null, error: j.error ?? null, ...(waiting ? { estimated_cost_usd: j.estimated_cost_usd } : {}), public: j.public && j.status === "done", poster: j.status === "done" ? j.assets?.poster ?? null : null,
  };
}

/** what the admin sees (still no task id / ip hash) */
export function adminView(j: Job) {
  return {
    id: j.id, status: j.status, prompt: j.prompt, preset: j.preset, duration: j.duration, resolution: j.resolution, created_utc: j.created_utc, estimated_cost_usd: j.estimated_cost_usd,
    actual_cost_usd: j.private?.actual_cost_usd ?? null, error: j.error ?? null, progress: j.progress ?? null, public: j.public, title: titleOf(j),
  };
}

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adminAction, adminList, adminLogin, blobGet, blobPut, jobStatus, publicDetail, publicList, submitRequest, workerClaim, workerUpdateRoute, workerUploadUrl } from "@/lib/handlers";
import { getKV } from "@/lib/store";
import { adminCookieHeader, ADMIN_PW, BASE, get, GOOD, post, useEnv, WORKER, workerHdr } from "./helpers";

useEnv();

const submit = async (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => submitRequest(post("/api/requests", { ...GOOD, ...over }, headers));
const act = async (id: string, action: string, body: unknown = {}) => adminAction(post(`/api/admin/jobs/${id}/${action}`, body, await adminCookieHeader()), id, action);
const claim = async (hdr: Record<string, string> = workerHdr) => workerClaim(post("/api/worker/claim", { worker: "pc-1" }, hdr));
const DONE = (id: string) => ({
  id, status: "done",
  assets: { dome: `${BASE}/api/blob/scenes/${id}/dome.mp4`, preview: `${BASE}/api/blob/scenes/${id}/preview.mp4`, poster: `${BASE}/api/blob/scenes/${id}/poster.jpg`, proof_sheet: `${BASE}/api/blob/scenes/${id}/proof_sheet.png` },
  scene: { projection: { model: "equidistant", fov_deg: 200, pitch_deg: 35, circle: { cx: 720, cy: 720, r: 720, size: 1440 }, feather: 0.05 }, video: { width: 1440, height: 1440, fps: 24, duration_s: 15, has_audio: true } },
  actual: { tokens: 108900, cost_usd: 1.165, task_id: "cgt-secret-task" },
});

describe("submitting a request", () => {
  it("needs the passcode and validates the prompt", async () => {
    process.env.REQUESTS_PER_HOUR_PER_IP = "100";
    expect((await submit({ passcode: "nope" })).status).toBe(403);
    expect((await submit({ passcode: undefined })).status).toBe(403);
    expect((await submit({ prompt: "x".repeat(401) })).status).toBe(400);
    expect((await submit({ prompt: "photo of Taylor Swift singing on a beach" })).status).toBe(400);
    expect((await submit({ prompt: "a Nike shoe floating in a quiet pond at dawn" })).status).toBe(400);
    expect((await submit({ prompt: "see https://example.com for a cat" })).status).toBe(400);
    expect((await submit({ preset: "zoom" })).status).toBe(400);
    expect((await submit({ duration: 99 })).status).toBe(400);
    expect((await submit({ resolution: "4k" })).status).toBe(400);
  });

  it("rate-limits per IP (3 per hour here), other IPs are unaffected", async () => {
    for (let i = 0; i < 3; i++) expect((await submit()).status).toBe(201);
    const r = await submit();
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await submit({}, { "x-forwarded-for": "198.51.100.77" })).status).toBe(201);
  });

  it("limits wrong passcodes harder (10 per hour)", async () => {
    process.env.REQUESTS_PER_HOUR_PER_IP = "100";
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await submit({ passcode: "guess" + i })).status;
    expect(last).toBe(429);
  });

  it("creates a pending job with an estimate, stores only a hashed IP", async () => {
    const r = await submit();
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j).toMatchObject({ status: "pending_approval", needs_approval: true, estimated_tokens: 108324, estimated_cost_usd: 1.16 });
    const stored = JSON.stringify(await getKV().get(`job:${j.id}`));
    expect(stored).not.toContain("203.0.113.5");
    const st = await (await jobStatus(get("/"), j.id)).json();
    expect(st.status).toBe("pending_approval");
    expect(JSON.stringify(st)).not.toMatch(/ip_hash|private|task/);
    expect((await jobStatus(get("/"), "not-an-id")).status).toBe(404);
  });

  it("refuses to run unconfigured", async () => {
    process.env.REQUEST_PASSCODE = "";
    expect((await submit()).status).toBe(503);
  });
});

describe("admin approval, caps", () => {
  it("login sets an httpOnly SameSite=Strict cookie; wrong password is 401; the list needs the cookie", async () => {
    expect((await adminLogin(post("/api/admin/login", { password: "wrong" }))).status).toBe(401);
    const ok = await adminLogin(post("/api/admin/login", { password: ADMIN_PW }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/);
    expect((await adminList(get("/"))).status).toBe(401);
    expect((await adminList(get("/", { cookie: "ss_admin=1.deadbeef" }))).status).toBe(401);
    expect((await adminList(get("/", await adminCookieHeader()))).status).toBe(200);
    expect((await adminAction(post("/x", {}), "0".repeat(24), "approve")).status).toBe(401);
  });

  it("login attempts are rate limited", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await adminLogin(post("/api/admin/login", { password: "bad" }))).status;
    expect(last).toBe(429);
  });

  it("approve -> queued, reserves spend; reject gives it back; cross-origin POST refused", async () => {
    const { id } = await (await submit()).json();
    expect((await act(id, "approve")).status).toBe(200);
    expect((await (await adminList(get("/", await adminCookieHeader()))).json()).spend.today_usd).toBe(1.16);
    expect((await act(id, "approve")).status).toBe(409);                 // not pending any more
    expect((await act(id, "reject")).status).toBe(200);                  // queued jobs can be cancelled: the reservation returns
    expect((await (await adminList(get("/", await adminCookieHeader()))).json()).spend.today_usd).toBe(0);
    const { id: id2 } = await (await submit()).json();
    const evil = post(`/api/admin/jobs/${id2}/approve`, {}, { ...(await adminCookieHeader()), origin: "https://evil.example", host: "localhost:3000" });
    expect((await adminAction(evil, id2, "approve")).status).toBe(403);
  });

  it("the daily cap and the per-scene cap are enforced at approval", async () => {
    process.env.DAILY_CAP_USD = "2.0";
    process.env.REQUESTS_PER_HOUR_PER_IP = "50";
    const a = (await (await submit()).json()).id, b = (await (await submit()).json()).id, big = (await (await submit({ duration: 15, resolution: "1080p" })).json()).id;
    expect((await act(a, "approve")).status).toBe(200);                 // 1.16
    const r = await act(b, "approve");                                  // 2.32 > 2.0
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/daily cap/);
    const r2 = await act(big, "approve");                               // 7.82 > 2.0 per scene
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toMatch(/per-scene cap/);
    expect((await getKV().get<{ status: string }>(`job:${b}`))!.status).toBe("pending_approval");
  });
});

describe("worker protocol", () => {
  it("claim/update/upload-url reject a missing or wrong secret and an unconfigured server", async () => {
    expect((await claim({})).status).toBe(401);
    expect((await claim({ "x-worker-secret": "x".repeat(40) })).status).toBe(401);
    expect((await workerUpdateRoute(post("/api/worker/update", { id: "a" }, {}))).status).toBe(401);
    expect((await workerUploadUrl(post("/api/worker/upload-url", { id: "a" }, { "x-worker-secret": "bad" }))).status).toBe(401);
    process.env.WORKER_SECRET = "short";
    expect((await claim({ "x-worker-secret": "short" })).status).toBe(503);
  });

  it("only approved jobs are claimed, oldest first, exactly once, even under a race", async () => {
    process.env.REQUESTS_PER_HOUR_PER_IP = "50";
    const a = (await (await submit()).json()).id, b = (await (await submit({ prompt: "an empty desert road at noon, heat haze" })).json()).id;
    expect((await (await claim()).json()).job).toBeNull();               // nothing approved yet: the PC gets nothing to spend money on
    await act(b, "approve");
    await act(a, "approve");
    const [r1, r2, r3] = await Promise.all([claim(), claim(), claim()]);
    const all = [await r1.json(), await r2.json(), await r3.json()];
    const r1Meta = async () => all.find((x) => x.job);
    const jobs = all.map((x) => x.job).filter(Boolean);
    expect(jobs.length).toBe(2);                                         // two approved jobs, three racing claims
    expect(new Set(jobs.map((j) => j.id)).size).toBe(2);
    expect(jobs[0]).toMatchObject({ preset: "static", duration: 5, resolution: "720p" });
    const c = await (await claim()).json();
    expect(c).toEqual({ job: null });                                    // idle: nothing but null (one Redis command)
    expect(await r1Meta()).toMatchObject({ daily_cap_usd: 5, max_cost_per_scene_usd: 2 });
    expect((await getKV().get<{ status: string }>(`job:${a}`))!.status).toBe("generating");
  });

  it("a silent worker's job is FAILED, never re-queued (no double billing)", async () => {
    const { id } = await (await submit()).json();
    await act(id, "approve");
    await claim();
    const j = (await getKV().get<Record<string, unknown>>(`job:${id}`))!;
    j.updated_utc = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    await getKV().set(`job:${id}`, j);
    expect((await (await claim()).json()).job).toBeNull();
    await adminList(get("/", await adminCookieHeader()));               // the admin view sweeps stale jobs too
    const after = (await getKV().get<{ status: string; error: string }>(`job:${id}`))!;
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/not re-run/);
  });

  it("update: transitions, progress, URL allowlist, private cost settles the spend, publish is explicit", async () => {
    const { id } = await (await submit()).json();
    const upd = (body: unknown, hdr = workerHdr) => workerUpdateRoute(post("/api/worker/update", body, hdr));
    expect((await upd({ id, status: "processing" })).status).toBe(409);        // still pending approval
    await act(id, "approve");
    expect((await upd({ id, status: "processing" })).status).toBe(409);        // not claimed yet
    await claim();
    expect((await upd({ id, status: "processing", progress: { stage: "encoding", pct: 55, message: "encoding" } })).status).toBe(200);
    expect((await (await jobStatus(get("/"), id)).json()).progress).toMatchObject({ stage: "encoding", pct: 55 });
    const evil = DONE(id);
    evil.assets.dome = "https://evil.example/dome.mp4";
    expect((await upd(evil)).status).toBe(400);                                   // asset URLs must be inside our blob store
    expect((await upd({ id, status: "done" })).status).toBe(400);
    const r = await upd(DONE(id));
    expect(r.status).toBe(200);
    expect((await upd({ id, status: "processing" })).status).toBe(409);        // terminal
    const spend = (await (await adminList(get("/", await adminCookieHeader()))).json()).spend.today_usd;
    expect(spend).toBe(1.165);                                                   // the reservation (1.16) was settled with the actual cost
    // done but NOT public yet
    expect((await publicDetail(get("/"), id)).status).toBe(404);
    expect((await (await publicList()).json())).toEqual([]);
  });

  it("a job the PC never submitted (cost 0) gives its reservation back", async () => {
    const { id } = await (await submit()).json();
    await act(id, "approve");
    await claim();
    const r = await workerUpdateRoute(post("/api/worker/update", { id, status: "failed", error: "PC daily cap reached", actual: { cost_usd: 0 } }, workerHdr));
    expect(r.status).toBe(200);
    expect((await (await adminList(get("/", await adminCookieHeader()))).json()).spend.today_usd).toBe(0);
    expect((await (await jobStatus(get("/"), id)).json())).toMatchObject({ status: "failed", error: "PC daily cap reached" });
  });
});

describe("uploads, public JSON, no leaks", () => {
  async function finished() {
    const { id } = await (await submit()).json();
    await act(id, "approve");
    await claim();
    return id as string;
  }

  it("upload-url: allowlisted names, size limits, job state, then a signed local PUT + Range GET after publishing", async () => {
    const id = await finished();
    const url = (body: unknown) => workerUploadUrl(post("/api/worker/upload-url", body, workerHdr));
    expect((await url({ id, filename: "evil.sh", size: 10 })).status).toBe(400);
    expect((await url({ id, filename: "dome.mp4", size: 999 * 1024 * 1024 })).status).toBe(413);
    expect((await url({ id: "0".repeat(24), filename: "dome.mp4", size: 10 })).status).toBe(404);
    const ok = await url({ id, filename: "dome.mp4", size: 1000 });
    expect(ok.status).toBe(200);
    const t = await ok.json();
    expect(t).toMatchObject({ method: "PUT", pathname: `scenes/${id}/dome.mp4` });
    const parts = new URL(t.url).pathname.replace(/^\/api\/blob\//, "").split("/");
    const bad = new Request(t.url.replace(/sig=[0-9a-f]+/, "sig=" + "0".repeat(64)), { method: "PUT", body: Buffer.alloc(100, 1) });
    expect((await blobPut(bad, parts)).status).toBe(403);
    const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const put = await blobPut(new Request(t.url, { method: "PUT", body: data }), parts);
    expect(put.status).toBe(200);
    expect(fs.readFileSync(path.join(process.cwd(), ".local-blob", ...parts)).equals(data)).toBe(true);
    // not published yet: the video is not served (404, like a missing file)
    expect((await blobGet(get(`/api/blob/${parts.join("/")}`), parts)).status).toBe(404);
    for (const f of ["preview.mp4", "poster.jpg"]) {
      const tt = await (await url({ id, filename: f, size: 10 })).json();
      await blobPut(new Request(tt.url, { method: "PUT", body: Buffer.alloc(10, 7) }), new URL(tt.url).pathname.replace(/^\/api\/blob\//, "").split("/"));
    }
    await workerUpdateRoute(post("/api/worker/update", DONE(id), workerHdr));
    expect((await act(id, "publish", { title: "Mammoths <b>x</b>" })).status).toBe(200);
    const full = await blobGet(get(`/api/blob/${parts.join("/")}`), parts);
    expect(full.status).toBe(200);
    const part = await blobGet(get(`/api/blob/${parts.join("/")}`, { range: "bytes=10-19" }), parts);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(Buffer.from(await part.arrayBuffer()).equals(data.subarray(10, 20))).toBe(true);
    expect((await blobGet(get("/x", { range: "bytes=5000-" }), parts)).status).toBe(416);
  });

  it("public JSON is an allowlist: no cost, tokens, task id, seed, ip, worker; private/unknown ids give the same 404; unpublish hides again", async () => {
    const id = await finished();
    await workerUpdateRoute(post("/api/worker/update", DONE(id), workerHdr));
    const before = await publicDetail(get("/"), id);
    const unknown = await publicDetail(get("/"), "f".repeat(24));
    expect(before.status).toBe(404);
    expect(await before.text()).toBe(await unknown.text());
    expect((await act(id, "publish", {})).status).toBe(200);
    const d = await (await publicDetail(get("/"), id)).json();
    expect(Object.keys(d).sort()).toEqual(["created_utc", "files", "id", "label", "projection", "prompt", "published_utc", "title", "video"]);
    expect(d.label).toBe("180° AI video dome (3DoF)");
    const blob = JSON.stringify([d, await (await publicList()).json(), await (await jobStatus(get("/"), id)).json()]).toLowerCase();
    for (const bad of ["cost", "token", "task", "seed", "cgt-secret", "ip_hash", "203.0.113.5", "worker", "reserved", "private", "price"]) expect(blob).not.toContain(bad);
    expect((await (await publicList()).json()).length).toBe(1);
    expect((await act(id, "unpublish")).status).toBe(200);
    expect((await publicDetail(get("/"), id)).status).toBe(404);
    expect((await (await publicList()).json())).toEqual([]);
    expect((await act(id, "publish")).status).toBe(200);
    void WORKER;
  });
});

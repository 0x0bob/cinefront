"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type AJob = { id: string; status: string; prompt: string; preset: string; duration: number; resolution: string; created_utc: string; estimated_cost_usd: number; actual_cost_usd: number | null; error: string | null; progress: { stage: string; pct: number; message?: string } | null; public: boolean; title: string };
type Data = { jobs: AJob[]; spend: { today_usd: number; daily_cap_usd: number; max_cost_per_scene_usd: number } };
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((100 * a) / b)) : 100);
const w = (p: number) => `w${Math.round(p / 10) * 10}`;

export default function AdminPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/jobs", { cache: "no-store" });
    if (r.status === 401) { setAuthed(false); return; }
    setAuthed(true);
    setData((await r.json()) as Data);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (!r.ok) { setMsg((await r.json()).error ?? "login failed"); return; }
    setPw("");
    load();
  }
  async function act(id: string, action: string, body: Record<string, unknown> = {}) {
    setMsg("");
    const r = await fetch(`/api/admin/jobs/${id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setMsg(`${action}: ${(await r.json()).error}`);
    load();
  }
  async function logout() { await fetch("/api/admin/logout", { method: "POST" }); setAuthed(false); setData(null); }

  if (authed === null) return <p className="note">Loading…</p>;
  if (!authed) {
    return (
      <form className="form card" onSubmit={login}>
        <label>Admin password<input type="password" name="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
        {msg && <p className="err" role="alert">{msg}</p>}
        <div><button className="btn" type="submit">Log in</button></div>
      </form>
    );
  }
  const jobs = data?.jobs ?? [];
  const sp = data?.spend;
  const group = (f: (j: AJob) => boolean) => jobs.filter(f);
  const pending = group((j) => j.status === "pending_approval");
  const running = group((j) => ["queued", "generating", "processing"].includes(j.status));
  const finished = group((j) => j.status === "done");
  const other = group((j) => j.status === "rejected" || j.status === "failed");
  const row = (j: AJob, acts: React.ReactNode) => (
    <div className="card job" key={j.id} data-id={j.id}>
      <div className="meta"><span className={`pill ${j.status}`}>{j.status}</span><span>{j.preset} · {j.duration} s · {j.resolution}</span><span>est ${j.estimated_cost_usd.toFixed(2)}{j.actual_cost_usd !== null ? ` · actual $${j.actual_cost_usd.toFixed(2)}` : ""}</span><span>{new Date(j.created_utc).toLocaleString()}</span></div>
      <p className="p">{j.prompt}</p>
      {j.progress && j.status !== "done" && <p className="note">{j.progress.stage}{j.progress.message ? `: ${j.progress.message}` : ""}</p>}
      {j.error && <p className="err">{j.error}</p>}
      <div className="acts">{acts}</div>
    </div>
  );
  return (
    <div className="admin">
      <div className="card">
        <p>Today&apos;s reserved spend: <strong id="spend">${(sp?.today_usd ?? 0).toFixed(2)}</strong> of the daily cap <strong>${(sp?.daily_cap_usd ?? 0).toFixed(2)}</strong> (per scene max ${(sp?.max_cost_per_scene_usd ?? 0).toFixed(2)})</p>
        <div className={`bar ${pct(sp?.today_usd ?? 0, sp?.daily_cap_usd ?? 0) >= 100 ? "bad" : pct(sp?.today_usd ?? 0, sp?.daily_cap_usd ?? 0) >= 80 ? "warn" : ""}`}><i className={w(pct(sp?.today_usd ?? 0, sp?.daily_cap_usd ?? 0))} /></div>
        <p className="note"><button className="btn ghost small" onClick={logout} type="button">Log out</button></p>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <h2>Pending approval ({pending.length})</h2>
      {pending.length === 0 && <p className="note">Nothing is waiting.</p>}
      {pending.map((j) => row(j, <>
        <button className="btn good small" type="button" data-action="approve" onClick={() => act(j.id, "approve")}>Approve (${j.estimated_cost_usd.toFixed(2)})</button>
        <button className="btn bad small" type="button" data-action="reject" onClick={() => act(j.id, "reject")}>Reject</button>
      </>))}
      <h2>In progress ({running.length})</h2>
      {running.map((j) => row(j, j.status === "queued" ? <button className="btn ghost small" type="button" onClick={() => act(j.id, "reject")}>Cancel</button> : null))}
      <h2>Finished ({finished.length})</h2>
      {finished.map((j) => row(j, <>
        <input type="text" aria-label="Title" placeholder={j.title} value={titles[j.id] ?? ""} onChange={(e) => setTitles({ ...titles, [j.id]: e.target.value })} />
        {j.public
          ? <button className="btn ghost small" type="button" data-action="unpublish" onClick={() => act(j.id, "unpublish")}>Unpublish</button>
          : <button className="btn small" type="button" data-action="publish" onClick={() => act(j.id, "publish", { title: titles[j.id] || undefined })}>Publish</button>}
        {j.public && <Link href={`/s/${j.id}`}>open</Link>}
      </>))}
      <h2>Rejected / failed ({other.length})</h2>
      {other.map((j) => row(j, null))}
    </div>
  );
}

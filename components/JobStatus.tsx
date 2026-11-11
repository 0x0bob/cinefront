"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type View = {
  id: string; status: string; prompt: string; preset: string; duration: number; resolution: string;
  progress: { stage: string; pct: number; message?: string } | null; error: string | null; estimated_cost_usd?: number; public: boolean; poster: string | null;
};
const STEPS: [string, string][] = [
  ["pending_approval", "Requested, waiting for approval"],
  ["queued", "Approved, waiting for the generator"],
  ["generating", "Generating the video"],
  ["processing", "Building the dome"],
  ["done", "Done"],
];
const TERMINAL = ["done", "rejected", "failed"];
const w = (pct: number) => `w${Math.max(0, Math.min(10, Math.round(pct / 10))) * 10}`;

export default function JobStatus({ id }: { id: string }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        if (r.status === 404) { setErr("This request does not exist."); return; }
        const j = (await r.json()) as View;
        if (stop) return;
        setV(j);
        setErr("");
        if (TERMINAL.includes(j.status)) return;
      } catch {
        if (!stop) setErr("Connection problem, retrying…");
      }
      timer = setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  if (err && !v) return <p className="err" role="alert">{err}</p>;
  if (!v) return <p className="note">Loading…</p>;
  const idx = STEPS.findIndex(([s]) => s === v.status);
  const bad = v.status === "rejected" || v.status === "failed";
  return (
    <div className="card" data-status={v.status}>
      <p><span className={`pill ${v.status}`} id="status">{v.status}</span></p>
      <p className="note">{v.preset} · {v.duration} s · {v.resolution}</p>
      <p>{v.prompt}</p>
      <ol className="steps" aria-label="Progress">
        {STEPS.map(([s, label], i) => (
          <li key={s} className={bad ? (i === 0 ? "done" : "") : i < idx ? "done" : i === idx ? "now" : ""}><span className="dot" />{label}</li>
        ))}
      </ol>
      {!bad && v.status !== "done" && v.progress && (
        <div>
          <div className="bar" role="progressbar" aria-valuenow={v.progress.pct}><i className={w(v.progress.pct)} /></div>
          <p className="note">{v.progress.message || v.progress.stage}</p>
        </div>
      )}
      {v.estimated_cost_usd !== undefined && <p className="note">Estimated cost ${v.estimated_cost_usd.toFixed(2)}. Nothing is generated until it is approved.</p>}
      {bad && <p className="err" role="alert">{v.status === "rejected" ? "This request was not generated." : "Generation failed."} {v.error ?? ""}</p>}
      {v.status === "done" && (
        <p>{v.public ? <Link className="btn" href={`/s/${v.id}`}>Open the dome</Link> : <span className="note">Finished. It will appear in the gallery once it is published.</span>}</p>
      )}
    </div>
  );
}

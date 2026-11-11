"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DURATIONS, RESOLUTIONS, estimate, type Resolution } from "@/lib/cost";
import type { Preset } from "@/lib/jobs";

const MAX = 400;

export default function RequestForm({ pricePerMtoken }: { pricePerMtoken: number }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<Preset>("static");
  const [duration, setDuration] = useState<number>(5);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const est = useMemo(() => estimate(duration, resolution, pricePerMtoken), [duration, resolution, pricePerMtoken]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, preset, duration, resolution, passcode }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "request failed");
      router.push(j.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
      setBusy(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit}>
      <label>
        What should the scene show?
        <textarea id="prompt" name="prompt" value={prompt} maxLength={MAX} required placeholder="a herd of woolly mammoths walks slowly toward you through a snowy valley at sunset" onChange={(e) => setPrompt(e.target.value)} />
        <span className="count">{prompt.length} / {MAX}</span>
      </label>
      <div className="seg" role="radiogroup" aria-label="Camera">
        <label>
          <input type="radio" name="preset" value="static" checked={preset === "static"} onChange={() => setPreset("static")} />
          <span>Static<small>The camera stays still. Anything in the scene can move.</small></span>
        </label>
        <label>
          <input type="radio" name="preset" value="ride" checked={preset === "ride"} onChange={() => setPreset("ride")} />
          <span>Ride<small>You rise smoothly, like a glass elevator.</small></span>
        </label>
        <label>
          <input type="radio" name="preset" value="glide" checked={preset === "glide"} onChange={() => setPreset("glide")} />
          <span>Glide · <em className="exp">Experimental</em><small>You drift slowly forward through the scene, like walking. No turns. May be uncomfortable for some people in VR.</small></span>
        </label>
      </div>
      {preset === "glide" && (
        <p className="note comfort" id="glide-note">Glide is experimental. The camera moves forward on its own, which some people find uncomfortable in a headset. Start with a short look and stop if you feel unwell. Clips that turn, speed up or move faster than walking pace are rejected automatically.</p>
      )}
      <div className="row">
        <label>
          Length
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} s</option>)}
          </select>
        </label>
        <label>
          Resolution
          <select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
            {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>
          Passcode
          <input type="password" name="passcode" autoComplete="off" value={passcode} required onChange={(e) => setPasscode(e.target.value)} />
        </label>
      </div>
      <p className="est" id="estimate">
        Estimated cost: <strong>${est.costUsd.toFixed(2)}</strong> ({est.tokens.toLocaleString("en-US")} tokens). Generation costs real money, so <strong>your request needs approval</strong> before anything is generated.
      </p>
      {error && <p className="err" role="alert">{error}</p>}
      <div><button className="btn" type="submit" disabled={busy || prompt.trim().length < 8}>{busy ? "Sending…" : "Request scene"}</button></div>
      <p className="note">No real people, no brands or logos. Prompts are limited to {MAX} characters.</p>
    </form>
  );
}

"use client";
import Link from "next/link";
import { useRef, useState } from "react";

export type CardScene = { id: string; title: string; label: string; created_utc: string; duration_s: number; poster: string; preview: string };

export default function SceneCard({ s }: { s: CardScene }) {
  const [hover, setHover] = useState(false);
  const v = useRef<HTMLVideoElement>(null);
  return (
    <Link className="scene" href={`/s/${s.id}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.poster} alt="" loading="lazy" decoding="async" />
        {hover && <video ref={v} src={s.preview} muted loop playsInline autoPlay preload="none" />}
      </div>
      <div className="body">
        <h2>{s.title}</h2>
        <p className="label">{s.label}</p>
        <p className="date">{new Date(s.created_utc).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })} · {Math.round(s.duration_s)} s</p>
      </div>
    </Link>
  );
}

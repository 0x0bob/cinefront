"use client";
// Dome viewer: a port of pipeline/scene_api/web/viewer.js. Three.js sphere seen from inside + the equidistant fisheye shader (lib/domeShader.ts, the same formula and constants as the
// Unity player's DomeMode.cs). Drag/touch to look (inertia), wheel/pinch zoom (FOV 40-100), tap-to-play, scrub bar, mute, WebXR (head rotation only, the dome follows the head position).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { DOME_FRAG, DOME_VERT, SPHERE_RADIUS, domeUniforms } from "@/lib/domeShader";

export type ViewerScene = {
  id: string; title: string; prompt: string; label: string; comfort_notice?: string;
  projection: { model: string; fov_deg: number; pitch_deg: number; circle: { cx: number; cy: number; r: number; size: number }; feather: number };
  video: { width: number; height: number; fps: number; duration_s: number; has_audio: boolean };
  files: { dome: string; preview: string; poster: string; proof_sheet?: string };
};

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const FOV_MIN = 40, FOV_MAX = 100, PITCH_LIMIT = 85;
const fmt = (t: number) => `${Math.floor(Math.max(0, t || 0) / 60)}:${String(Math.floor(Math.max(0, t || 0) % 60)).padStart(2, "0")}`;

type Api = { start: () => Promise<void>; togglePlay: () => void; toggleMute: () => void; seek: (f: number) => void; toggleGyro: () => void; fullscreen: () => void };

export default function DomeViewer({ scene }: { scene: ViewerScene }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const vrRef = useRef<HTMLSpanElement>(null);
  const api = useRef<Api | null>(null);
  const [tap, setTap] = useState(true);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState({ t: 0, d: scene.video.duration_s });
  const [gyroAvail, setGyroAvail] = useState(false);
  const [gyroOn, setGyroOn] = useState(false);
  const [fallback, setFallback] = useState("");

  useEffect(() => {
    document.body.classList.add("viewer-page");
    return () => document.body.classList.remove("viewer-page");
  }, []);

  useEffect(() => {
    const stage = stageRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      if (!renderer.getContext()) throw new Error("no WebGL context");
    } catch {
      setFallback("WebGL failed");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.appendChild(renderer.domElement);
    const cv = renderer.domElement;
    const onLost = () => setFallback("WebGL context lost");
    cv.addEventListener("webglcontextlost", onLost);

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.poster = scene.files.poster;
    video.src = scene.files.dome;
    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;

    const three = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
    camera.rotation.order = "YXZ";
    const mat = new THREE.ShaderMaterial({ uniforms: domeUniforms(THREE, tex, scene.projection), vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_RADIUS, 96, 64), mat);
    three.add(dome);

    const st = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, fov: 75, gyro: false, dq: new THREE.Quaternion() };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch0 = 0, fov0 = 0, lastMove = 0;
    const size = () => {
      const w = stage.clientWidth || window.innerWidth, h = stage.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const applyCamera = () => {
      camera.fov = st.fov;
      camera.updateProjectionMatrix();
      if (st.gyro) camera.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -st.yaw * DEG)).multiply(st.dq);
      else camera.rotation.set(st.pitch * DEG, -st.yaw * DEG, 0, "YXZ");          // yaw > 0 looks right, pitch > 0 looks up
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      st.vyaw = st.vpitch = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        fov0 = st.fov;
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) st.fov = clamp((fov0 * pinch0) / d, FOV_MIN, FOV_MAX);
        return;
      }
      const k = st.fov / (cv.clientHeight || 600);          // degrees per pixel
      st.yaw -= dx * k;
      st.pitch = clamp(st.pitch + dy * k, -PITCH_LIMIT, PITCH_LIMIT);
      st.vyaw = -dx * k;
      st.vpitch = dy * k;
      lastMove = performance.now();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (performance.now() - lastMove > 80) st.vyaw = st.vpitch = 0;
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); st.fov = clamp(st.fov + e.deltaY * 0.05, FOV_MIN, FOV_MAX); };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", size);

    // device orientation (phones)
    const zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      const orient = ((screen.orientation && screen.orientation.angle) || 0) * DEG;
      eul.set(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, "YXZ");
      st.dq.setFromEuler(eul).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
    };
    if ("DeviceOrientationEvent" in window && window.matchMedia("(pointer: coarse)").matches) setGyroAvail(true);

    const setPlayState = () => setPaused(video.paused);
    video.addEventListener("play", setPlayState);
    video.addEventListener("pause", setPlayState);

    const start = async () => {
      setTap(false);
      video.muted = false;
      setMuted(false);
      try { await video.play(); } catch {
        video.muted = true;
        setMuted(true);
        try { await video.play(); } catch { /* needs another tap */ }
      }
      setPaused(video.paused);
    };
    api.current = {
      start,
      togglePlay: () => { if (video.paused) void start(); else video.pause(); },
      toggleMute: () => { video.muted = !video.muted; setMuted(video.muted); },
      seek: (f) => { video.currentTime = f * (video.duration || scene.video.duration_s); },
      toggleGyro: async () => {
        if (st.gyro) { st.gyro = false; window.removeEventListener("deviceorientation", onOrient); setGyroOn(false); return; }
        try {
          const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
          if (typeof D.requestPermission === "function" && (await D.requestPermission()) !== "granted") return;
          window.addEventListener("deviceorientation", onOrient);
          st.gyro = true;
          setGyroOn(true);
        } catch { /* stay on drag */ }
      },
      fullscreen: () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); },
    };

    // WebXR: head rotation only (3DoF); the dome follows the head POSITION, like the APK
    renderer.xr.enabled = true;
    renderer.xr.addEventListener("sessionstart", () => { void start(); });
    const vrBtn = VRButton.createButton(renderer);
    vrRef.current?.appendChild(vrBtn);
    const head = new THREE.Vector3();

    const frame = () => {
      if (!renderer.xr.isPresenting) {
        st.yaw += st.vyaw;
        st.pitch = clamp(st.pitch + st.vpitch, -PITCH_LIMIT, PITCH_LIMIT);
        st.vyaw *= 0.93; st.vpitch *= 0.93;
        if (Math.abs(st.vyaw) < 0.002) st.vyaw = 0;
        if (Math.abs(st.vpitch) < 0.002) st.vpitch = 0;
        applyCamera();
        dome.position.set(0, 0, 0);
      } else {
        head.setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
        dome.position.copy(head);
      }
      renderer.render(three, camera);
    };
    size();
    applyCamera();
    renderer.setAnimationLoop(frame);
    const clock = setInterval(() => setTime({ t: video.currentTime, d: video.duration || scene.video.duration_s }), 250);

    // hooks for the automated shader check (pipeline/tests/test_vercel_e2e.py); harmless in production
    (window as unknown as { __viewer: unknown }).__viewer = {
      video, ready: true,
      setSize(w: number, h: number) { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
      setView(yaw: number, pitch: number, fov: number) { st.yaw = yaw; st.pitch = pitch; st.fov = fov; st.vyaw = st.vpitch = 0; applyCamera(); },
      stop() { renderer.setAnimationLoop(null); },
      snapshot() { tex.needsUpdate = true; renderer.render(three, camera); return renderer.domElement.toDataURL("image/png"); },
    };

    return () => {
      clearInterval(clock);
      renderer.setAnimationLoop(null);
      cv.removeEventListener("webglcontextlost", onLost);
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", size);
      window.removeEventListener("deviceorientation", onOrient);
      video.pause();
      video.removeAttribute("src");
      video.load();
      tex.dispose();
      mat.dispose();
      dome.geometry.dispose();
      renderer.dispose();
      vrBtn.remove();
      cv.remove();
      delete (window as unknown as { __viewer?: unknown }).__viewer;
    };
  }, [scene]);

  if (fallback) {
    return (
      <section className="fallback">
        <p>The 3D view is not available here ({fallback}). This is a flat preview of the dome.</p>
        <video src={scene.files.preview} poster={scene.files.poster} controls loop muted playsInline />
        <Link className="back" href="/gallery">← Gallery</Link>
      </section>
    );
  }
  return (
    <>
      <div className="stage" ref={stageRef} />
      <header className="vtop">
        <Link className="back" href="/gallery" aria-label="Back to the gallery">← Gallery</Link>
        <div className="vinfo">
          <h1>{scene.title}</h1>
          <p className="label">180° AI video dome — generated from a text prompt, not a 3D reconstruction{scene.comfort_notice ? " (glide, experimental)" : ""}</p>
          {scene.comfort_notice && <p className="comfort" id="comfort">{scene.comfort_notice}</p>}
          <p className="prompt">{scene.prompt}</p>
          <p className="hint">Drag to look around · wheel or pinch to zoom{scene.files.proof_sheet ? <> · <a href={scene.files.proof_sheet} target="_blank" rel="noopener">proof sheet</a></> : null}</p>
        </div>
      </header>
      {tap && <button className="tap" type="button" id="tap" onClick={() => api.current?.start()}>▶&nbsp; Tap to play</button>}
      <div className="controls">
        <button type="button" id="play" aria-label={paused ? "Play" : "Pause"} onClick={() => api.current?.togglePlay()}>{paused ? "▶" : "❚❚"}</button>
        <input type="range" min={0} max={1000} value={Math.round((1000 * time.t) / (time.d || 1))} aria-label="Seek" onChange={(e) => api.current?.seek(Number(e.target.value) / 1000)} />
        <span className="time">{fmt(time.t)} / {fmt(time.d)}</span>
        <button type="button" aria-label="Mute" onClick={() => api.current?.toggleMute()}>{muted ? "🔇" : "🔊"}</button>
        {gyroAvail && <button type="button" className={gyroOn ? "on" : ""} onClick={() => api.current?.toggleGyro()}>Gyro</button>}
        <button type="button" aria-label="Fullscreen" onClick={() => api.current?.fullscreen()}>⛶</button>
        <span className="vrslot" ref={vrRef} />
      </div>
    </>
  );
}

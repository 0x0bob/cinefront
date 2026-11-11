import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { estimate } from "@/lib/cost";
import { checkPrompt, MAX_PROMPT } from "@/lib/filter";
import { DOME_FRAG, DOME_VERT, EDGE_FRACTION, BACKGROUND, SPHERE_RADIUS } from "@/lib/domeShader";
import { middleware, config } from "@/middleware";

const REPO = path.resolve(__dirname, "..", "..");

describe("cost estimate = the PC pipeline's estimate", () => {
  it("720p/5 s and 1080p/15 s", () => {
    expect(estimate(5, "720p", 10.7)).toEqual({ tokens: 108324, costUsd: 1.16 });
    expect(estimate(15, "1080p", 10.7)).toEqual({ tokens: 731187, costUsd: 7.82 });
  });
});

describe("prompt filter", () => {
  it("limits the length and blocks real people, brands and links", () => {
    expect(checkPrompt("a calm lake at dawn, mist over the water").ok).toBe(true);
    expect(checkPrompt("x".repeat(MAX_PROMPT + 1)).ok).toBe(false);
    expect(checkPrompt("short").ok).toBe(false);
    for (const bad of ["Elon Musk on Mars at sunrise", "a Coca-Cola bottle in the snow", "Mickey at Disney castle", "see http://x.y/z"]) expect(checkPrompt(bad).ok).toBe(false);
    expect(checkPrompt("a tesla coil sparking in a lab").ok).toBe(false);                       // the blocklist is blunt, on purpose
    expect(checkPrompt("a trumpet player on a rooftop at dusk").ok).toBe(true);                  // whole words only
    const r = checkPrompt("a  calm \u0000lake\n at   dawn");
    expect(r.ok && r.prompt).toBe("a calm lake at dawn");
  });
});

describe("dome shader port stays identical to the PC viewer and the Unity player", () => {
  it("same GLSL, same constants", () => {
    const js = fs.readFileSync(path.join(REPO, "pipeline/scene_api/web/dome_shader.js"), "utf8").replace(/\r\n/g, "\n");
    const glsl = (name: string) => new RegExp("export const " + name + " = `([\\s\\S]*?)`;").exec(js)![1];
    expect(DOME_VERT).toBe(glsl("DOME_VERT"));
    expect(DOME_FRAG).toBe(glsl("DOME_FRAG"));
    expect(js).toContain(`EDGE_FRACTION = ${EDGE_FRACTION}`);
    expect(js).toContain(`SPHERE_RADIUS = ${SPHERE_RADIUS}`);
    const cs = fs.readFileSync(path.join(REPO, "quest/SceneShiftUnity/Assets/SceneShift/Dome/DomeMode.cs"), "utf8");
    expect(cs).toContain("halfFov * 0.998f");
    expect(EDGE_FRACTION).toBe(0.998);
    expect(BACKGROUND).toEqual([0.01, 0.01, 0.015]);
    expect(cs).toContain("rho = th / halfFov * j.r");
    expect(DOME_FRAG).toContain("theta / halfFov * circle.z");
    expect(DOME_FRAG).toContain("d_dome = Rx(+tilt) d_level");
  });
});

describe("CSP middleware", () => {
  it("per-request nonce, no inline/eval in production, no framing, not on /api", () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const a = middleware(new NextRequest("http://localhost/gallery")).headers.get("content-security-policy")!;
    const b = middleware(new NextRequest("http://localhost/gallery")).headers.get("content-security-policy")!;
    (process.env as Record<string, string>).NODE_ENV = prev!;
    expect(a).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(a).not.toContain("unsafe-eval");
    expect(a).not.toContain("unsafe-inline");
    expect(a).toContain("frame-ancestors 'none'");
    expect(a).toContain("object-src 'none'");
    expect(a.match(/nonce-([^']+)/)![1]).not.toBe(b.match(/nonce-([^']+)/)![1]);
    expect(JSON.stringify(config)).toContain("(?!api");
  });
});

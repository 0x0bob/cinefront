import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { adminAction, publicDetail, submitRequest, workerClaim, workerUpdateRoute } from "@/lib/handlers";
import { setKV } from "@/lib/store";
import { adminCookieHeader, BASE, get, GOOD, post, useEnv, workerHdr } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
useEnv();

const submit = (over: Record<string, unknown> = {}) => submitRequest(post("/api/requests", { ...GOOD, ...over }));

describe("glide preset (experimental)", () => {
  it("accepts glide, rejects unknown presets, dry-run estimate is the same as the other presets", async () => {
    process.env.REQUESTS_PER_HOUR_PER_IP = "50";
    const g = await submit({ preset: "glide" });
    expect(g.status).toBe(201);
    const gj = await g.json();
    const s = await (await submit({ preset: "static" })).json();
    expect(gj.estimated_cost_usd).toBe(s.estimated_cost_usd);
    expect(gj.estimated_cost_usd).toBeCloseTo(1.16, 2);                      // 720p / 5 s
    const bad = await submit({ preset: "sprint" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/static, ride, glide/);
  });

  it("the worker is told the preset; the public scene is labelled experimental with a comfort notice, other presets are not", async () => {
    process.env.REQUESTS_PER_HOUR_PER_IP = "50";
    const ids: Record<string, string> = {};
    for (const preset of ["glide", "static"]) ids[preset] = (await (await submit({ preset, prompt: `a quiet forest path in the morning light, ${preset}` })).json()).id;
    const hdr = await adminCookieHeader();
    for (const id of Object.values(ids)) await adminAction(post(`/api/admin/jobs/${id}/approve`, {}, hdr), id, "approve");
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) seen.push((await (await workerClaim(post("/api/worker/claim", { worker: "pc" }, workerHdr))).json()).job.preset);
    expect(seen.sort()).toEqual(["glide", "static"]);
    for (const [preset, id] of Object.entries(ids)) {
      const done = {
        id, status: "done",
        assets: { dome: `${BASE}/api/blob/scenes/${id}/dome.mp4`, preview: `${BASE}/api/blob/scenes/${id}/preview.mp4`, poster: `${BASE}/api/blob/scenes/${id}/poster.jpg` },
        scene: { projection: { model: "equidistant", fov_deg: 200, pitch_deg: 0, circle: { cx: 720, cy: 720, r: 720, size: 1440 }, feather: 0.05 }, video: { width: 1440, height: 1440, fps: 24, duration_s: 5, has_audio: false } },
        actual: { cost_usd: 1.16 },
      };
      expect((await workerUpdateRoute(post("/api/worker/update", done, workerHdr))).status).toBe(200);
      await adminAction(post(`/api/admin/jobs/${id}/publish`, {}, hdr), id, "publish");
      const pub = await (await publicDetail(get("/"), id)).json();
      if (preset === "glide") {
        expect(pub.label).toBe("180° AI video dome (3DoF) (glide, experimental)");
        expect(pub.comfort_notice).toMatch(/uncomfortable/);
      } else {
        expect(pub.label).toBe("180° AI video dome (3DoF)");
        expect(pub.comfort_notice).toBeUndefined();
      }
    }
  });

  it("the request form shows three cameras with the agreed copy", async () => {
    const { default: RequestForm } = await import("@/components/RequestForm");
    const html = renderToStaticMarkup(React.createElement(RequestForm, { pricePerMtoken: 10.7 }));
    expect(html.match(/name="preset"/g)).toHaveLength(3);
    expect(html).toContain("Glide");
    expect(html).toContain("Experimental");
    expect(html).toContain("You drift slowly forward through the scene, like walking. No turns. May be uncomfortable for some people in VR.");
    expect(html).toContain("The camera stays still. Anything in the scene can move.");
    expect(html).toContain("You rise smoothly, like a glass elevator.");
    expect(html).not.toContain("glide-note");                                  // the comfort note appears only once Glide is selected
  });
});

describe("no store connected", () => {
  it("answers 503 with a clear message instead of a bare 500", async () => {
    setKV(undefined);
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const r = await submit();
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/Upstash/);
  });
});

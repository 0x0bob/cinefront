// Asset storage. Production: Vercel Blob (public store), uploaded DIRECTLY from the PC with a short-lived client token (the 4.5 MB function body limit makes proxying impossible).
// Local/tests (BLOB_DRIVER=local): files in web/.local-blob, written through a signed PUT and served by /api/blob/... (with Range for the video).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cfg } from "./config";

export const ALLOWED: Record<string, { type: string; maxBytes: number }> = {
  "dome.mp4": { type: "video/mp4", maxBytes: 60 * 1024 * 1024 },
  "preview.mp4": { type: "video/mp4", maxBytes: 40 * 1024 * 1024 },
  "poster.jpg": { type: "image/jpeg", maxBytes: 2 * 1024 * 1024 },
  "proof_sheet.png": { type: "image/png", maxBytes: 8 * 1024 * 1024 },
  "scene.json": { type: "application/json", maxBytes: 64 * 1024 },
};
export const LOCAL_ROOT = () => path.join(process.cwd(), ".local-blob");

export type UploadTarget = { method: "PUT"; url: string; headers: Record<string, string>; pathname: string; expires_at: number };

const sig = (pathname: string, exp: number) => crypto.createHmac("sha256", cfg().workerSecret + "|blob").update(`${pathname}|${exp}`).digest("hex");
export const verifyLocalSig = (pathname: string, exp: number, s: string) => exp > Date.now() && s.length === 64 && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(pathname, exp)));

export function pathFor(id: string, filename: string) { return `scenes/${id}/${filename}`; }

export async function makeUploadTarget(id: string, filename: string, origin: string): Promise<UploadTarget> {
  const spec = ALLOWED[filename];
  if (!spec) throw new Error("file not allowed");
  const pathname = pathFor(id, filename);
  const exp = Date.now() + 15 * 60 * 1000;
  if (cfg().blobDriver === "local") {
    const base = (cfg().baseUrl || origin).replace(/\/$/, "");
    return { method: "PUT", url: `${base}/api/blob/${pathname}?exp=${exp}&sig=${sig(pathname, exp)}`, headers: { "content-type": spec.type }, pathname, expires_at: exp };
  }
  const rw = process.env.BLOB_READ_WRITE_TOKEN;
  if (!rw) throw new Error("BLOB_READ_WRITE_TOKEN is not set (connect a Vercel Blob store to the project)");
  // a short-lived client token for exactly this pathname/type/size, then the Blob REST call that the SDK's client put() makes (same endpoint and headers: @vercel/blob 2.x, API version 13)
  const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
  const token = await generateClientTokenFromReadWriteToken({ token: rw, pathname, allowedContentTypes: [spec.type], maximumSizeInBytes: spec.maxBytes, validUntil: exp, addRandomSuffix: false, allowOverwrite: true } as never);
  return {
    method: "PUT",
    url: `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`,
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "13",
      "x-vercel-blob-access": "public",
      "x-content-type": spec.type,
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-vercel-blob-store-id": token.split("_")[3] ?? "",
      "content-type": spec.type,
    },
    pathname,
    expires_at: exp,
  };
}

/** only URLs that point at our own blob store (or the local driver) may be stored as assets */
export function acceptableAssetUrl(u: unknown, id: string, filename: string, origin: string): string | null {
  if (typeof u !== "string" || u.length > 600) return null;
  try {
    const url = new URL(u);
    if (cfg().blobDriver === "local") {
      const base = new URL((cfg().baseUrl || origin).replace(/\/$/, ""));
      return url.origin === base.origin && url.pathname === `/api/blob/${pathFor(id, filename)}` ? url.origin + url.pathname : null;
    }
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com") && url.pathname.endsWith(`/${pathFor(id, filename)}`) ? url.origin + url.pathname : null;
  } catch {
    return null;
  }
}

export function writeLocal(pathname: string, data: Buffer) {
  const root = LOCAL_ROOT();
  const p = path.join(root, pathname);
  if (!p.startsWith(root + path.sep)) throw new Error("bad path");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

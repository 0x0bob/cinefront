import { NextResponse, type NextRequest } from "next/server";

// Content-Security-Policy with a per-request nonce (Next.js puts it on its own scripts). No inline script/style, no eval in production, no framing.
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const blob = "https://*.public.blob.vercel-storage.com";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    `img-src 'self' data: blob: ${blob}`,
    `media-src 'self' blob: ${blob}`,
    `connect-src 'self' ${blob}${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = { matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico).*)" }] };

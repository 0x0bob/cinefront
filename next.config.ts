import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // security headers that do not need a per-request nonce (the CSP with its nonce is set in middleware.ts)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "xr-spatial-tracking=(self), accelerometer=(self), gyroscope=(self), fullscreen=(self), camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

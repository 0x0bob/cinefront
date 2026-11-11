import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "SceneShift: text to 180° video dome",
  description: "Describe a scene, get a 180° AI video dome you can look around in, on a screen or in a VR headset.",
  icons: { icon: "data:," },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();          // dynamic rendering: every response carries its own CSP nonce (middleware.ts)
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

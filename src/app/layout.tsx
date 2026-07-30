import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Flux",
  description: "Task & project management for Foodverse",
  // Absolute URLs (manifest, icons, any future OG tags) resolve against this.
  // Read from env — never hardcode the domain (see CLAUDE.md).
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  manifest: "/manifest.webmanifest",
  applicationName: "Flux",
  icons: {
    // favicon.ico is picked up from the app/ file convention; these cover the
    // larger surfaces (installed launchers, iOS home screen).
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Flux",
    // iOS has no maskable/theme-colour concept — this keeps the status bar
    // dark so it blends into the app's near-black shell.
    statusBarStyle: "black-translucent",
  },
};

/**
 * Separate from `metadata` because Next 16 requires themeColor/viewport to be
 * exported as `viewport` — leaving them on `metadata` is a build-time warning
 * and they get ignored.
 */
export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Dark-only in v1 — the `dark` class keeps shadcn `dark:` variants active
    // while all tokens already carry dark values on :root.
    <html lang="en" className={`${outfit.variable} dark h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}

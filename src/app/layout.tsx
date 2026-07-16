import type { Metadata } from "next";
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

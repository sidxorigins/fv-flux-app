import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for deployment (Prisma Compute unpacks this
  // archive onto a small disk — keep it lean; dev caches must never ship).
  output: "standalone",
};

export default nextConfig;

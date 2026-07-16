import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env files. Next.js keeps secrets in .env.local,
// so load them here (best-effort) for CLI commands that need the datasource URL
// (migrate deploy/dev, studio, seed). Offline commands (validate, generate,
// migrate diff --from-empty) don't need a URL and work with these unset.
for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), file));
  } catch {
    // File may not exist in every environment — ignore.
  }
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    // Prisma 7 seed wiring lives here (was package.json "prisma".seed in v6).
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prisma 7 reads the connection URL from here (not the schema). Migrate,
    // Studio, and the schema engine use it. Prefer the direct (unpooled) URL
    // for migrations, falling back to the pooled URL. Empty strings are ignored
    // via `||` so offline commands (generate/validate) don't pick up "".
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});

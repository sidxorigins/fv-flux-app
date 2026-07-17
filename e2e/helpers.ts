// Shared e2e constants. Credentials come from the seed script
// (`prisma/seed.ts`) via .env.local — see playwright.config.ts for env loading.

export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "it@iccadubai.ae";
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";

export function requireCredentials(): void {
  if (!ADMIN_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is not set. Add it to .env.local and re-run `npx prisma db seed` so the e2e suite can sign in.",
    );
  }
}

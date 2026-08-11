/**
 * Mint a wall-display token.
 *
 * The plaintext is printed ONCE and never recoverable — only its sha256 hash is
 * stored, same contract as API keys.
 *
 * Usage:
 *   npx tsx scripts/mint-display-token.mts "Office TV"
 *   npx tsx scripts/mint-display-token.mts --list
 *   npx tsx scripts/mint-display-token.mts --revoke <prefix>
 */
import { prisma } from "../src/lib/db";
import { generateDisplayToken } from "../src/lib/display-token";

const [cmd, arg] = process.argv.slice(2);

if (cmd === "--list") {
  const tokens = await prisma.displayToken.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  if (tokens.length === 0) console.log("no display tokens");
  for (const t of tokens) {
    const state = t.revokedAt ? "REVOKED" : "active";
    const used = t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 16) : "never";
    console.log(`${t.prefix}…  ${state.padEnd(8)} ${t.name.padEnd(24)} last used ${used}`);
  }
} else if (cmd === "--revoke") {
  if (!arg) {
    console.error("usage: --revoke <prefix>");
    process.exit(1);
  }
  const updated = await prisma.displayToken.updateMany({
    where: { prefix: { startsWith: arg }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(updated.count > 0 ? `revoked ${updated.count} token(s)` : "no match");
} else {
  const name = cmd ?? "Wall display";
  // Attribute to an admin — createdById is required, and the audit trail is
  // worth more than allowing an orphaned token.
  const admin = await prisma.user.findFirst({
    where: { globalRole: "ADMIN", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!admin) {
    console.error("no active admin to attribute the token to");
    process.exit(1);
  }

  const { token, prefix, tokenHash } = generateDisplayToken();
  await prisma.displayToken.create({
    data: { name, prefix, tokenHash, createdById: admin.id },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log(`\n✓ created "${name}" (by ${admin.email})\n`);
  console.log("  Open this on the wall display — shown once, not recoverable:\n");
  console.log(`  ${base}/display?token=${token}\n`);
}

await prisma.$disconnect();

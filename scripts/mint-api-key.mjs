// Mint an API key for an actor user, directly in the DB. Run on the box:
//   cd /var/www/flux && node scripts/mint-api-key.mjs --email siddharth@iccadubai.ae --name "claude-agent-1"
// Prints the plaintext key ONCE. Format matches src/lib/api-key.ts.
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

function arg(flag) { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; }
const email = arg("--email");
const name = arg("--name") ?? "agent-key";
if (!email) { console.error("usage: node scripts/mint-api-key.mjs --email <actor> --name <label>"); process.exit(2); }

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try { const m = fs.readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*(.*)$/m); if (m) return m[1].trim().replace(/^["']|["']$/g, ""); } catch {}
  return null;
}
const url = dbUrl();
if (!url) { console.error("DATABASE_URL not found"); process.exit(1); }

const key = "flux_sk_" + crypto.randomBytes(24).toString("base64url");
const prefix = key.slice(0, 16);
const keyHash = crypto.createHash("sha256").update(key).digest("hex");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const u = await client.query('SELECT id, name FROM "User" WHERE lower(email)=lower($1)', [email]);
  if (!u.rows.length) { console.error(`no user ${email}`); process.exit(1); }
  const uid = u.rows[0].id;
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO "ApiKey"(id,name,prefix,"keyHash","userId","createdById","createdAt")
     VALUES($1,$2,$3,$4,$5,$5,now())`,
    [id, name, prefix, keyHash, uid],
  );
  console.log(`Minted API key "${name}" for ${u.rows[0].name} <${email}>.`);
  console.log(`KEY (shown once): ${key}`);
} catch (e) {
  console.error("MINT FAILED:", e.message);
  process.exitCode = 1;
} finally { await client.end(); }

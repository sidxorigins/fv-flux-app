import "server-only";

import { createSign } from "node:crypto";
import { gunzipSync } from "node:zlib";

// App Store Connect — daily Sales & Trends reports, which is where iOS download
// counts actually live (there is no "downloads" REST resource).
//
// Auth differs from Google's: an ES256 JWT signed with a .p8 EC key, carrying
// the issuer id and key id, valid 20 minutes max.
//
// The response is a GZIPPED TAB-SEPARATED report, not JSON.
//
// CONFIG (env):
//   ASC_ISSUER_ID       UUID from App Store Connect → Users and Access → Keys
//   ASC_KEY_ID          the key's 10-char id
//   ASC_PRIVATE_KEY     contents of the AuthKey_XXXX.p8 ("\n" escaped)
//   ASC_VENDOR_NUMBER   from App Store Connect → Payments and Financial Reports

const ASC_API = "https://api.appstoreconnect.apple.com/v1";
const AUDIENCE = "appstoreconnect-v1";

export class AscConfigError extends Error {}

export interface AscConfig {
  issuerId: string;
  keyId: string;
  privateKey: string;
  vendorNumber: string;
}

export function ascConfig(): AscConfig {
  const issuerId = process.env.ASC_ISSUER_ID;
  const keyId = process.env.ASC_KEY_ID;
  const privateKey = process.env.ASC_PRIVATE_KEY;
  const vendorNumber = process.env.ASC_VENDOR_NUMBER;

  if (!issuerId || !keyId || !privateKey || !vendorNumber) {
    throw new AscConfigError(
      "App Store Connect not configured — set ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY, ASC_VENDOR_NUMBER",
    );
  }
  return {
    issuerId,
    keyId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    vendorNumber,
  };
}

export function isAscConfigured(): boolean {
  try {
    ascConfig();
    return true;
  } catch {
    return false;
  }
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/**
 * ES256 JWT. Apple rejects tokens valid for more than 20 minutes, so this is
 * minted per call rather than cached — signing is cheap and a cached token
 * would be a foot-gun on a long sync.
 *
 * `dsa` encoding matters: node's default DER signature is rejected by Apple,
 * which requires the raw IEEE-P1363 (r||s) form.
 */
function ascJwt(cfg: AscConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: cfg.keyId, typ: "JWT" }),
  );
  const payload = b64url(
    JSON.stringify({
      iss: cfg.issuerId,
      iat: now,
      exp: now + 15 * 60,
      aud: AUDIENCE,
    }),
  );

  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(
    { key: cfg.privateKey, dsaEncoding: "ieee-p1363" },
    "base64url",
  );

  return `${header}.${payload}.${signature}`;
}

export type ReportFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/**
 * Report version differs by frequency, and Apple rejects the wrong one with a
 * 400 rather than falling back:
 *   DAILY / WEEKLY   → 1_1
 *   MONTHLY / YEARLY → 1_0   (verified against the live API)
 */
function versionFor(frequency: ReportFrequency): string {
  return frequency === "DAILY" || frequency === "WEEKLY" ? "1_1" : "1_0";
}

/**
 * A SALES/SUMMARY report as raw TSV, or null when Apple has nothing for that
 * period.
 *
 * `reportDate` format depends on frequency: YYYY-MM-DD for daily/weekly,
 * YYYY-MM for monthly, YYYY for yearly.
 *
 * 404 and 410 are both routine and mean "no report": 404 for a period before
 * the app existed or not yet finalised, 410 for one Apple has since expired.
 * Neither is an error worth failing a sync over.
 */
export async function fetchSalesReport(
  reportDate: string,
  frequency: ReportFrequency = "DAILY",
): Promise<string | null> {
  const cfg = ascConfig();

  const params = new URLSearchParams({
    "filter[frequency]": frequency,
    "filter[reportType]": "SALES",
    "filter[reportSubType]": "SUMMARY",
    "filter[vendorNumber]": cfg.vendorNumber,
    "filter[reportDate]": reportDate,
    "filter[version]": versionFor(frequency),
  });

  const res = await fetch(`${ASC_API}/salesReports?${params}`, {
    headers: {
      Authorization: `Bearer ${ascJwt(cfg)}`,
      Accept: "application/a-gzip",
    },
  });

  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    throw new Error(
      `App Store Connect salesReports failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }

  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
}

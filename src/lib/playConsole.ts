import "server-only";

import { googleAccessToken, normalisePrivateKey } from "./googleAuth";

// Google Play install statistics.
//
// IMPORTANT — WHY NOT THE PLAY DEVELOPER REPORTING API: that API (verified
// against its REST reference) exposes ONLY vitals metric sets — crash rate, ANR
// rate, error counts, slow rendering. There is no installs or acquisitions
// endpoint. Play install counts are published exclusively as CSV reports in a
// private Cloud Storage bucket owned by the developer account.
//
// So this reads objects from `gs://pubsite_prod_rev_<id>/stats/installs/...`
// over the Cloud Storage JSON API. Same service-account auth as GA4, different
// scope.
//
// CONFIG (env):
//   PLAY_BUCKET_ID        e.g. "pubsite_prod_rev_01234567890987654321"
//   PLAY_PACKAGE_NAME     e.g. "com.foodverseapp"
//   PLAY_SA_CLIENT_EMAIL  service account with "View app information: Global"
//   PLAY_SA_PRIVATE_KEY   its PEM key
// Falls back to the GA service account when the PLAY_SA_* pair is absent, since
// one service account can hold both grants.

const SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";
const STORAGE_API = "https://storage.googleapis.com/storage/v1";

export class PlayConfigError extends Error {}

export interface PlayConfig {
  bucketId: string;
  packageName: string;
  clientEmail: string;
  privateKey: string;
}

export function playConfig(): PlayConfig {
  const bucketId = process.env.PLAY_BUCKET_ID;
  const packageName = process.env.PLAY_PACKAGE_NAME;
  const clientEmail =
    process.env.PLAY_SA_CLIENT_EMAIL ?? process.env.GA_SA_CLIENT_EMAIL;
  const privateKey = process.env.PLAY_SA_PRIVATE_KEY ?? process.env.GA_SA_PRIVATE_KEY;

  if (!bucketId || !packageName || !clientEmail || !privateKey) {
    throw new PlayConfigError(
      "Play Console not configured — set PLAY_BUCKET_ID, PLAY_PACKAGE_NAME (+ PLAY_SA_* or GA_SA_* credentials)",
    );
  }
  return {
    bucketId,
    packageName,
    clientEmail,
    privateKey: normalisePrivateKey(privateKey),
  };
}

export function isPlayConfigured(): boolean {
  try {
    playConfig();
    return true;
  } catch {
    return false;
  }
}

/** Object path for one month's country-dimensioned installs report. */
export function installsObjectPath(packageName: string, yyyymm: string): string {
  return `stats/installs/installs_${packageName}_${yyyymm}_country.csv`;
}

/**
 * Fetch one monthly installs CSV. Returns null when the object doesn't exist —
 * a month with no report yet is normal (Play publishes with a 1-2 day lag and
 * the current month's file appears only once there's data), not an error.
 */
export async function fetchInstallsCsv(yyyymm: string): Promise<string | null> {
  const cfg = playConfig();
  const token = await googleAccessToken(
    { clientEmail: cfg.clientEmail, privateKey: cfg.privateKey },
    SCOPE,
  );

  const objectPath = encodeURIComponent(
    installsObjectPath(cfg.packageName, yyyymm),
  );
  const res = await fetch(
    `${STORAGE_API}/b/${encodeURIComponent(cfg.bucketId)}/o/${objectPath}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Play installs fetch failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }

  // Play publishes these as UTF-16LE with a BOM — decoding as UTF-8 yields
  // NUL-separated mojibake and a silently empty parse.
  const buf = Buffer.from(await res.arrayBuffer());
  const isUtf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  return isUtf16 ? buf.toString("utf16le").replace(/^﻿/, "") : buf.toString("utf8");
}

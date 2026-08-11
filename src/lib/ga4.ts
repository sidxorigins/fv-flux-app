import "server-only";

import {
  googleAccessToken,
  invalidateGoogleToken,
  normalisePrivateKey,
} from "./googleAuth";

// Minimal GA4 Data API v1beta client.
//
// WHY NOT `@google-analytics/data`: the official client drags in the full gRPC
// stack for what is, for our needs, two POSTs to a REST endpoint. Service-account
// auth lives in lib/googleAuth.ts (shared with the Play Console reader), so
// this file is just the Data API surface. Revisit if we ever need
// streaming/batch APIs.
//
// CREDENTIALS come from env only (never a checked-in key file):
//   GA4_PROPERTY_ID       numeric property id, e.g. 433277300
//   GA_SA_CLIENT_EMAIL    service-account email
//   GA_SA_PRIVATE_KEY     the PEM private key ("\n" escapes are unescaped below,
//                         so it survives being stored on one line in .env)

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

export class Ga4ConfigError extends Error {}
export class Ga4ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Ga4Config {
  propertyId: string;
  clientEmail: string;
  privateKey: string;
}

/** Throws `Ga4ConfigError` when the integration isn't configured — callers
 * treat that as "feature off", distinct from "Google returned an error". */
export function ga4Config(): Ga4Config {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const clientEmail = process.env.GA_SA_CLIENT_EMAIL;
  const privateKey = process.env.GA_SA_PRIVATE_KEY;

  if (!propertyId || !clientEmail || !privateKey) {
    throw new Ga4ConfigError(
      "GA4 not configured — set GA4_PROPERTY_ID, GA_SA_CLIENT_EMAIL, GA_SA_PRIVATE_KEY",
    );
  }
  return {
    propertyId,
    clientEmail,
    // Env vars can't hold real newlines portably, so the key is stored with
    // literal "\n" and restored here.
    privateKey: normalisePrivateKey(privateKey),
  };
}

export function isGa4Configured(): boolean {
  try {
    ga4Config();
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report shapes (only the fields we consume)
// ─────────────────────────────────────────────────────────────────────────────

export interface Ga4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}
export interface Ga4Report {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: Ga4Row[];
}

export interface RunReportRequest {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const cfg = ga4Config();
  const token = await googleAccessToken(
    { clientEmail: cfg.clientEmail, privateKey: cfg.privateKey },
    SCOPE,
  );

  const res = await fetch(`${DATA_API}/properties/${cfg.propertyId}:${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    // A 401 usually means a clock-skewed or rotated key — drop the cached
    // token so the next attempt re-mints rather than replaying a dead one.
    if (res.status === 401) invalidateGoogleToken(cfg.clientEmail, SCOPE);
    throw new Ga4ApiError(`GA4 ${path} failed: ${text.slice(0, 500)}`, res.status);
  }
  return (await res.json()) as T;
}

export function runReport(body: RunReportRequest): Promise<Ga4Report> {
  return post<Ga4Report>("runReport", body);
}

export function runRealtimeReport(body: {
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  limit?: number;
}): Promise<Ga4Report> {
  return post<Ga4Report>("runRealtimeReport", body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared query fragments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Excludes non-production web traffic. The property is polluted with a
 * developer's `localhost` (90 sessions), raw EC2 IPs, the ELB hostname and the
 * Google Translate proxy — all of which would inflate the wall board. App
 * traffic has no hostName, so this filter is only ever applied to web queries.
 */
export const PRODUCTION_HOST = "www.foodverse.io";

export const productionHostFilter = {
  filter: {
    fieldName: "hostName",
    stringFilter: { matchType: "EXACT", value: PRODUCTION_HOST },
  },
} as const;

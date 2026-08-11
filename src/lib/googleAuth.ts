import "server-only";

import { createSign } from "node:crypto";

// Shared Google service-account auth: signs a JWT and exchanges it for an
// access token. Used by lib/ga4.ts (Analytics Data API) and lib/playConsole.ts
// (Cloud Storage), which authenticate identically but against different scopes.
//
// Rolled by hand rather than via google-auth-library: it's ~40 lines with
// node:crypto and keeps the serverless bundle free of the gapi stack.

const TOKEN_URI = "https://oauth2.googleapis.com/token";

export class GoogleAuthError extends Error {}

export interface ServiceAccountCredentials {
  clientEmail: string;
  /** PEM private key. Literal "\n" sequences are unescaped by the caller. */
  privateKey: string;
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/** Env vars store PEM keys on one line, so newlines arrive escaped. */
export function normalisePrivateKey(key: string): string {
  return key.replace(/\\n/g, "\n");
}

// Tokens live an hour. Cached per (email, scope) and refreshed a minute early
// so a long sync never presents one mid-expiry.
const cache = new Map<string, { token: string; expiresAt: number }>();

export async function googleAccessToken(
  creds: ServiceAccountCredentials,
  scope: string,
): Promise<string> {
  const cacheKey = `${creds.clientEmail}:${scope}`;
  const now = Math.floor(Date.now() / 1000);

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${signer.sign(creds.privateKey, "base64url")}`;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new GoogleAuthError(`token exchange failed: ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(cacheKey, {
    token: json.access_token,
    expiresAt: now + json.expires_in,
  });
  return json.access_token;
}

/** Drop a cached token — call after a 401 so the next attempt re-mints rather
 * than replaying a key that has been rotated or is clock-skewed. */
export function invalidateGoogleToken(clientEmail: string, scope: string): void {
  cache.delete(`${clientEmail}:${scope}`);
}

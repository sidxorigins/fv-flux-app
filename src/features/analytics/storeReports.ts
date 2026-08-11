// Pure parsers for the two store report formats. No I/O, no server imports —
// unit-testable without credentials (see storeReports.test.ts), which matters
// because the live APIs need secrets we may not have in CI.

export interface DailyInstalls {
  /** UTC-midnight day the count describes. */
  periodStart: Date;
  installs: number;
}

/** "2026-08-09" / "2026-08-09 00:00:00" → UTC midnight, or null if unparseable. */
function parseIsoDay(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    return null;
  }
  return date;
}

/** Split a CSV line, honouring double-quoted fields (country names contain commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  // Only trim whitespace — do NOT strip quotes here. The loop above already
  // consumed the delimiting quotes and turned "" into a literal ", so a
  // trailing-quote strip would eat real content out of a field like: say "hi"
  return out.map((f) => f.trim());
}

/**
 * Which Play column to count.
 *
 *  "device" — "Daily Device Installs": one install per DEVICE, so a user with
 *             a phone and a tablet counts twice. The larger number.
 *  "user"   — "Daily User Installs": unique Google accounts.
 *
 * NOTE ON COMPARABILITY: Apple counts a first download per Apple ID (a second
 * device on the same account is a re-download, product type 3, which we
 * exclude). So iOS is account-shaped. Pairing it with "device" means the
 * iOS/Android split counts different things — deliberate here, but don't read
 * the two as like-for-like.
 */
export type PlayInstallColumn = "device" | "user";

/**
 * Google Play monthly installs CSV → per-day totals.
 *
 * The file is dimensioned by country, so each date appears once per country and
 * the rows must be summed. Columns are matched BY HEADER NAME, not position:
 * Play has changed column order between report versions, and a positional
 * parser would silently read the wrong number rather than fail.
 *
 * Falls back to the other column when the preferred one is absent, so an older
 * report layout still parses rather than returning nothing.
 */
export function parsePlayInstallsCsv(
  csv: string,
  column: PlayInstallColumn = "device",
): DailyInstalls[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const dateIdx = header.indexOf("date");
  const userIdx = header.indexOf("daily user installs");
  const deviceIdx = header.indexOf("daily device installs");

  const preferred = column === "device" ? deviceIdx : userIdx;
  const fallback = column === "device" ? userIdx : deviceIdx;
  const installIdx = preferred !== -1 ? preferred : fallback;
  if (dateIdx === -1 || installIdx === -1) return [];

  const byDay = new Map<number, number>();

  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    const day = parseIsoDay(fields[dateIdx] ?? "");
    if (!day) continue;
    const value = Number(fields[installIdx]);
    if (!Number.isFinite(value)) continue;
    byDay.set(day.getTime(), (byDay.get(day.getTime()) ?? 0) + value);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, installs]) => ({ periodStart: new Date(time), installs }));
}

/**
 * Apple "Product Type Identifier" codes that denote a FIRST-TIME download.
 *
 * Apple encodes updates as 7/7F/7T and re-downloads as 3/3F — counting those
 * as installs is the classic way to overstate iOS numbers several-fold, so the
 * allowlist is explicit rather than a `startsWith("1")` guess.
 */
export const FIRST_DOWNLOAD_PRODUCT_TYPES = new Set([
  "1", // iPhone / iPod touch app
  "1F", // iPad app
  "1T", // Universal app
  "1E", // Custom (B2B) app
  "1EP", // Custom app, per-device
  "1EU", // Custom app, per-user
  "F1", // Mac app
  "FI1", // iOS app on Mac
]);

/**
 * App Store Connect daily SALES/SUMMARY TSV → one day's first-time downloads.
 *
 * Matched by header name for the same reason as the Play parser. Returns 0 for
 * a report containing only updates/re-downloads — which is a real answer, not a
 * parse failure.
 */
export function parseAscSalesTsv(tsv: string): number {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return 0;

  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const typeIdx = header.indexOf("product type identifier");
  const unitsIdx = header.indexOf("units");
  if (typeIdx === -1 || unitsIdx === -1) return 0;

  let total = 0;
  for (const line of lines.slice(1)) {
    const fields = line.split("\t");
    const type = (fields[typeIdx] ?? "").trim().toUpperCase();
    if (!FIRST_DOWNLOAD_PRODUCT_TYPES.has(type)) continue;
    const units = Number((fields[unitsIdx] ?? "").trim());
    if (!Number.isFinite(units)) continue;
    total += units;
  }
  return total;
}

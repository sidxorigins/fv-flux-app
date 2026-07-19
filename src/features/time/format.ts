// Minutes <-> human duration. Shared client + server (no server-only imports).

/** e.g. 150 → "2h 30m", 120 → "2h", 45 → "45m", <=0 → "0m". */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Parse "2h 30m", "2h", "45m", or a bare minute count ("90") into whole minutes.
 * Returns null for anything unparseable or non-positive.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : null;
  }
  const match = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const minutes = (Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0);
  return minutes > 0 ? minutes : null;
}

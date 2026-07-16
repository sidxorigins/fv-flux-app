// Pure presentation helpers for attachment rows. No React, no server imports —
// safe to use in the client component.

import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from "lucide-react";

/** Pick an icon by MIME group. */
export function iconForContentType(contentType: string): LucideIcon {
  if (contentType.startsWith("image/")) return FileImage;
  if (contentType === "application/zip") return FileArchive;
  if (contentType === "text/csv" || contentType.includes("spreadsheetml")) {
    return FileSpreadsheet;
  }
  if (
    contentType === "application/pdf" ||
    contentType.startsWith("text/") ||
    contentType.includes("wordprocessingml") ||
    contentType.includes("presentationml")
  ) {
    return FileText;
  }
  return File;
}

/** Human-readable byte size, e.g. `24 B`, `1.4 KB`, `12 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

/**
 * Truncate a filename in the middle, preserving the start and the extension so
 * `annual-report-2026-final-v3.pdf` reads as `annual-rep…v3.pdf`.
 */
export function truncateMiddle(name: string, max = 32): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const base = dot > 0 ? name.slice(0, dot) : name;
  const keep = max - ext.length - 1; // room for the ellipsis
  if (keep < 4) return `${name.slice(0, max - 1)}…`;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${base.slice(0, head)}…${base.slice(base.length - tail)}${ext}`;
}

/**
 * Display-hygiene only (React already escapes, so this is not a security
 * boundary): drop C0/DEL/C1 control characters from a filename for display.
 */
export function sanitizeFilename(name: string): string {
  let out = "";
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    if (!isControl) out += ch;
  }
  return out.trim() || "file";
}

// Attachment upload/serve POLICY — the pure decisions that gate what can be
// uploaded and how it comes back out. These break silently: a type quietly
// dropped from the allowlist, or an executable type losing its forced download,
// produces no error anywhere until someone exploits it or a user complains.
//
// Imports the real module (no mock): the helpers under test are pure and
// `lib/r2` does no work at import time.

import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ALLOWED_TYPES,
  ATTACHMENT_MAX_BYTES,
  NEVER_INLINE_TYPES,
  VIDEO_MAX_BYTES,
  maxBytesForType,
  mustForceDownload,
} from "./r2";

const allowed = ATTACHMENT_ALLOWED_TYPES as readonly string[];

describe("ATTACHMENT_ALLOWED_TYPES", () => {
  it("accepts the iPhone camera formats", () => {
    // HEIC is the iOS default since iOS 11 — the single most likely upload
    // failure for a phone-first team.
    expect(allowed).toContain("image/heic");
    expect(allowed).toContain("image/heif");
  });

  it("accepts the common web and scanner image formats", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/bmp",
      "image/tiff",
    ]) {
      expect(allowed).toContain(type);
    }
  });

  it("accepts the video container formats", () => {
    for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
      expect(allowed).toContain(type);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(allowed).size).toBe(allowed.length);
  });

  it("still excludes types with no legitimate attachment use", () => {
    // Not an exhaustive blocklist — the allowlist is the mechanism. These are
    // spot checks that the list did not get widened carelessly.
    for (const type of [
      "application/x-msdownload", // .exe
      "application/x-sh",
      "application/javascript",
      "text/javascript",
      "application/x-httpd-php",
    ]) {
      expect(allowed).not.toContain(type);
    }
  });
});

describe("mustForceDownload", () => {
  it("forces download for every script-capable type", () => {
    // SVG and HTML are allowed for convenience but must never render: both can
    // carry <script>, and /api/files/[id] serves inline by default.
    expect(mustForceDownload("image/svg+xml")).toBe(true);
    expect(mustForceDownload("text/html")).toBe(true);
  });

  it("leaves ordinary types renderable inline", () => {
    // Inline rendering is what makes images work in comment bodies.
    for (const type of ["image/png", "image/jpeg", "application/pdf", "video/mp4"]) {
      expect(mustForceDownload(type)).toBe(false);
    }
  });

  it("covers exactly the NEVER_INLINE_TYPES list", () => {
    for (const type of NEVER_INLINE_TYPES) {
      expect(mustForceDownload(type)).toBe(true);
    }
  });

  it("every never-inline type is actually uploadable", () => {
    // A forced-download rule for a type nobody can upload is dead code, and
    // would hide the fact that the type was dropped from the allowlist.
    for (const type of NEVER_INLINE_TYPES) {
      expect(allowed).toContain(type);
    }
  });

  it("does not match on a prefix", () => {
    // "text/html" must not make "text/html-sandboxed" or "text/plain" match.
    expect(mustForceDownload("text/plain")).toBe(false);
    expect(mustForceDownload("text/htmlx")).toBe(false);
  });
});

describe("maxBytesForType", () => {
  it("gives video the 1 GB ceiling", () => {
    for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
      expect(maxBytesForType(type)).toBe(VIDEO_MAX_BYTES);
    }
  });

  it("gives everything else the 25 MB ceiling", () => {
    for (const type of [
      "image/png",
      "image/heic",
      "application/pdf",
      "text/html",
      "application/zip",
    ]) {
      expect(maxBytesForType(type)).toBe(ATTACHMENT_MAX_BYTES);
    }
  });

  it("keeps the video ceiling meaningfully larger", () => {
    expect(VIDEO_MAX_BYTES).toBeGreaterThan(ATTACHMENT_MAX_BYTES);
  });

  it("falls back to the strict ceiling for an unknown type", () => {
    // Defence in depth: an unrecognised type should get the SMALLER budget, so
    // a future allowlist addition can never silently inherit 1 GB.
    expect(maxBytesForType("application/octet-stream")).toBe(ATTACHMENT_MAX_BYTES);
    expect(maxBytesForType("")).toBe(ATTACHMENT_MAX_BYTES);
  });

  it("does not treat a type merely containing 'video' as video", () => {
    expect(maxBytesForType("application/x-video-metadata")).toBe(
      ATTACHMENT_MAX_BYTES,
    );
  });
});

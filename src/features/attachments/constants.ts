// Client-safe re-export of the attachment limit + allowlist.
//
// `lib/r2` is the single source of truth for these values, but it also imports
// the AWS S3 SDK and `node:crypto` at module scope. Those are server-only, so we
// don't want a client bundle pulling them in. This module re-exports ONLY the
// two plain primitive values (a number and a readonly string tuple) — neither
// depends on the SDK/crypto imports, and `lib/r2` performs no work at import
// time (env is read lazily inside its functions), so bundler tree-shaking drops
// the server-only code and the browser shares the exact same constants without
// redefining them.

export { ATTACHMENT_MAX_BYTES, ATTACHMENT_ALLOWED_TYPES } from "@/lib/r2";
export type { AttachmentContentType } from "@/lib/r2";

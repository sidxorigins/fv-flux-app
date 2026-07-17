# Comment attachments + inline images — design

**Date:** 2026-07-17
**Status:** Approved (design + 3 sign-offs), implementing.

## Goal

In the task-drawer comment composer, let a user:
1. **Attach files** to a comment — shown as a file list under the posted comment.
2. **Upload images inline** — paste / drop / insert an image that renders inline in the comment text.

Both via the existing private-R2 presigned pipeline. No third-party upload service.

## Constraints (from CLAUDE.md)

- Private R2 bucket — no public access; bytes move browser↔R2 via presigned URLs; the R2 key is never exposed/rendered.
- Sanitise rich text server-side before persist; never render unsanitised HTML.
- Validate + authorise every Server Action and Route Handler on the server.
- Migrations via `prisma migrate`, never `db push`.

## Core problem

Inline `<img>` lives in **stored HTML** and needs a **stable src**. A presigned GET expires (10 min), so it can't be embedded. Solution: an authorised image-serve route that keeps the bucket private.

## Approach (chosen)

**Attachment id + authorised serve route.** Every uploaded file becomes an `Attachment` row immediately (also powers the file list). Inline images are stored as `<img src="/api/files/<attachmentId>">`. `GET /api/files/[id]` authorises then 302-redirects to a fresh presigned GET.

Rejected: (B) buffer-in-client + rewrite HTML on submit — fragile. (C) public image bucket — violates the private-bucket rule.

## Data model (migration)

Add to `Attachment`:
- `commentId String?` — nullable FK → `Comment`, `onDelete: Cascade`.
- `@@index([commentId])`.

`taskId` stays **required**. A comment attachment carries both `taskId` (its comment's task) and `commentId`. This keeps existing project/task-delete R2-key collection (`where: { task: { projectId } }`) working with zero changes.

Attachment states:
- **Draft**: `commentId = null` — uploaded in the composer, not yet posted.
- **Linked**: `commentId` set — belongs to a posted comment.

## Upload flow

1. Composer affordances: toolbar **upload button** + **drag-drop** + **paste** (image paste/drop → inline).
2. Per file: `requestCommentUpload({ taskId, filename, contentType, size })` → presigned PUT (reuse `presignUploadUrl`, signs type+length). Key = `buildAttachmentKey(taskId, filename)`.
3. Client PUTs to R2 (`putWithProgress`).
4. `finalizeCommentUpload({ taskId, key, filename, contentType, size })` → creates `Attachment` row (`commentId: null`) → returns `{ id, contentType }`. (No task ActivityLog for drafts.)
5. If image → insert `<img src="/api/files/<id>" alt="<filename>">` at cursor. Every file → composer tray (pending list, removable).
6. **Post**: `addComment({ taskId, body, attachmentIds })`:
   - Validate each id: exists, `taskId` matches, `commentId` null, `uploaderId === user.id`.
   - In one tx: create `Comment`, set `commentId` on those attachments, ActivityLog `commented`.
   - Notifications/mentions unchanged.

## Serve route

`GET /api/files/[id]`:
- Resolve attachment → its `task.projectId`.
- `requireProjectRole(projectId, "VIEWER")` (session from `auth()`).
- 302 → `presignDownloadUrl(key)` **without** forced `Content-Disposition: attachment` (inline display). A `?download=1` variant forces the attachment disposition for the file-list "download" affordance.
- Add `/api/files` to the proxy public-path bypass? No — it must stay authed. It self-authorises; leave it behind normal session gating (it reads the session cookie directly via `auth()`).

## Sanitiser (security-critical)

Allow `<img>` in `RICH_TEXT_OPTIONS`, but locked down:
- `allowedAttributes.img = ["src", "alt"]`.
- `src` allowlist: `transformTags.img` drops the node unless `src` matches `^/api/files/[A-Za-z0-9]+$` (our own relative serve path only). No external src, no `data:`, no `onerror`, no `srcset`, no `style`.
- Defense-in-depth in `addComment`/`updateComment`: after sanitising, strip `<img>` whose id ∉ the linked attachment set.

## Lifecycle

- **Delete comment** (`deleteComment`): gather its attachment keys → delete rows (cascade) + R2 objects (`deleteObjects`) → AuditLog breadcrumb on partial R2 failure (mirrors task delete). 
- **Edit comment** (`updateComment`): accept `attachmentIds`; link new ones, unlink+delete removed ones (rows + R2). Keep minimal.
- **Orphan drafts**: extend the daily cron (`/api/cron/due-reminders` sibling or same job) to delete `commentId = null` attachments older than 24h + their R2 objects.

## Reuse

`putWithProgress`, `presignUploadUrl`/`presignDownloadUrl`, `buildAttachmentKey`, `ATTACHMENT_ALLOWED_TYPES` (already includes png/jpeg/webp/gif + docs), `ATTACHMENT_MAX_BYTES` (25 MB), `AttachmentSection` visual patterns, `RichTextContent` renderer (+ img styles in editor.css).

## New dependency

`@tiptap/extension-image@3.28.0` (matches installed `@tiptap/*` 3.28). Paste/drop upload wired via `editorProps.handlePaste`/`handleDrop` in `RichTextEditor`.

## Files

- `prisma/schema.prisma` + migration — `Attachment.commentId`.
- `src/features/attachments/` — `requestCommentUpload`, `finalizeCommentUpload` actions + schemas; comment-attachment query/type.
- `src/features/comments/actions.ts` + `schemas.ts` — `addComment`/`updateComment` accept `attachmentIds`; img-id enforcement.
- `src/lib/sanitize.ts` — allow locked-down `<img>`.
- `src/app/api/files/[id]/route.ts` — serve route.
- `src/components/editor/RichTextEditor.tsx` — Image node + paste/drop/upload; new `onUpload` prop.
- `src/features/comments/components/CommentSection.tsx` + `CommentItem.tsx` — composer tray, attachment list, wire upload.
- `src/features/notifications/reminders` (or cron route) — orphan-draft sweep.
- Tests: sanitiser img allow/deny; addComment attachment-id validation; serve-route authz.

## Testing

- Unit: sanitiser (allow `/api/files/<id>`, drop external/`data:`/`onerror`); `addComment` rejects foreign/linked/other-user attachment ids; strips unowned `<img>`.
- e2e: paste-less path — upload image → inline render; attach file → list; delete comment removes files; VIEWER can view images, cannot post.
- Manual: desktop + 390px mobile.

## Out of scope

Resize/crop, captions, galleries, video, external image URLs, drag-to-reorder attachments.

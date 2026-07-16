// Public surface of the attachments feature.
//
// Like the comments barrel, this composes SERVER pieces (queries — Prisma-backed,
// `server-only`) with a CLIENT component (AttachmentSection). Import it from
// Server Components that fetch data and render the section into the task drawer
// slot; client-only callers should import `AttachmentSection` from its module
// path directly.

export type { AttachmentUploader, AttachmentWithUploader } from "./types";
export {
  ATTACHMENT_ALLOWED_TYPES,
  ATTACHMENT_MAX_BYTES,
  type AttachmentContentType,
} from "./constants";
export {
  requestUploadSchema,
  finalizeSchema,
  deleteSchema,
  type RequestUploadInput,
  type FinalizeInput,
  type DeleteInput,
} from "./schemas";
export { getAttachments } from "./queries";
export {
  requestAttachmentUpload,
  finalizeAttachment,
  getAttachmentDownloadUrl,
  deleteAttachment,
} from "./actions";
export {
  AttachmentSection,
  type AttachmentSectionProps,
} from "./components/AttachmentSection";

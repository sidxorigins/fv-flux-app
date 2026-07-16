// Public surface of the comments feature.
//
// This barrel composes SERVER pieces (queries — Prisma-backed, `server-only`)
// with a CLIENT component (CommentSection). It is intended to be imported from
// Server Components that fetch data and render the section into the task drawer
// slot. Client-only callers should import `CommentSection` from its module path
// directly rather than through this barrel.

export type { CommentAuthor, CommentWithAuthor } from "./types";
export {
  addCommentSchema,
  updateCommentSchema,
  deleteCommentSchema,
  type AddCommentInput,
  type UpdateCommentInput,
  type DeleteCommentInput,
} from "./schemas";
export { getComments } from "./queries";
export { addComment, updateComment, deleteComment } from "./actions";
export { CommentSection, type CommentSectionProps } from "./components/CommentSection";

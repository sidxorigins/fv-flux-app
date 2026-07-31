// Pure helpers for the repeatable `?assigneeId=` filter shared by the board,
// the backlog, and the project-header member stack.
//
// Deliberately free of "use client" and of any React/Next import: the project
// page (a Server Component) and MemberFilterStack (a client component) both
// reach for this, and a helper re-exported from a client module breaks the
// server render.
//
// Two values are aliases rather than user ids:
//   "me"   — the signed-in user, written by TaskFilters so a saved view stays
//            portable between people. Resolved to a real id server-side.
//   "none" — unassigned. Never a member, so it round-trips untouched here.

/** `true` when `userId` is filtered on, under either their id or the `me` alias. */
export function isAssigneeSelected(
  values: readonly string[],
  userId: string,
  currentUserId: string,
): boolean {
  return (
    values.includes(userId) ||
    (userId === currentUserId && values.includes("me"))
  );
}

/**
 * The `assigneeId` list after toggling `userId`, preserving order and every
 * unrelated value (including "none" and other members).
 *
 * De-selecting the signed-in user clears BOTH spellings — otherwise a filter
 * TaskFilters wrote as "me" would survive being clicked off in the stack.
 */
export function toggleAssigneeValue(
  values: readonly string[],
  userId: string,
  currentUserId: string,
): string[] {
  if (!isAssigneeSelected(values, userId, currentUserId)) {
    return [...values, userId];
  }
  const aliases =
    userId === currentUserId ? new Set([userId, "me"]) : new Set([userId]);
  return values.filter((v) => !aliases.has(v));
}

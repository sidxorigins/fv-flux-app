export interface CommentReactionGroup {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: string[];
}

interface RawReaction {
  emoji: string;
  userId: string;
  user: { name: string };
}

/** Group raw reaction rows (first-seen emoji order) into per-emoji summaries. */
export function groupReactions(
  rows: RawReaction[],
  sessionUserId: string,
): CommentReactionGroup[] {
  const map = new Map<string, CommentReactionGroup>();
  for (const r of rows) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, reactedByMe: false, users: [] };
    g.count += 1;
    g.users.push(r.user.name);
    if (r.userId === sessionUserId) g.reactedByMe = true;
    map.set(r.emoji, g);
  }
  return [...map.values()];
}

# Design — Emoji in Comments (Feature #1)

Date: 2026-07-21
Branch: `feat/emoji-comments`
Source: Flux_Proposed_New_Features.docx #1.

Two capabilities: (a) insert emojis into comment text via an emoji picker in the
comment composer; (b) emoji **reactions** on existing comments (any emoji, counts,
who reacted, toggle).

---

## Locked decisions
- **Picker library: emoji-mart** (`emoji-mart` + `@emoji-mart/data` + `@emoji-mart/react`).
  Full searchable set, categories, frequently-used, skin tones. Re-themed to the dark/glass
  tokens (orange accent) via emoji-mart's CSS custom properties. **New dependency** — the
  CLAUDE.md "ask first" was asked + approved.
- **Reactions: full** — react with ANY emoji; reactions render as chips (emoji + count);
  the current user's reactions are highlighted; hover/tap shows who reacted; clicking a chip
  toggles the user's reaction. Backed by a new `CommentReaction` model.
- **Emoji insert** lives in the comment composer only (opt-in `showEmoji` prop on the shared
  `RichTextEditor`) — task descriptions are unchanged.
- **Reaction permission: VIEWER+** on the comment's task's project (anyone who can see the
  comment can react — consistent with the VIEWER+ watch-toggle; reactions don't mutate task data).

## Non-goals (v1)
- Reactions on tasks/attachments (comments only). Custom/uploaded emojis. Per-reaction
  notifications. Skin-tone persistence beyond emoji-mart's own localStorage.

---

## Data model
New model:
```prisma
model CommentReaction {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  emoji     String   // the native unicode emoji, e.g. "👍"
  createdAt DateTime @default(now())

  comment Comment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([commentId, userId, emoji]) // one of each emoji per user per comment
  @@index([commentId])
}
```
- `Comment` gains `reactions CommentReaction[]`; `User` gains `commentReactions CommentReaction[]`.
- Migration is additive.

## Server (`features/comments/`)
- Zod: `reactionSchema = z.object({ commentId, emoji: z.string().min(1).max(32) })` (emoji is a
  short unicode string; cap length; reject empty).
- Action `toggleCommentReaction(input)`:
  1. Load the comment → its `taskId` → the task's `projectId`; 404 if missing.
  2. `requireProjectRole(projectId, "VIEWER")`.
  3. Upsert-toggle: if a `(commentId, userId, emoji)` row exists → delete; else create.
  4. `revalidatePath(\`/projects/${projectId}\`, "layout")`. Returns `{ reacted: boolean }`.
- Extend the comments read (`features/comments/queries.ts` `getComments`) to include reactions,
  shaped per comment as `reactions: { emoji, count, reactedByMe, users: string[] }[]` (grouped by
  emoji, sorted by first-reacted). Resolve `reactedByMe` against the session user; `users` = display
  names for the tooltip. Grouping done in the query (not N+1 — one `include` + in-memory group).

## UI
- `features/comments/components/EmojiPicker.tsx` — a thin wrapper around `@emoji-mart/react`'s
  `Picker` with `data` from `@emoji-mart/data`, `theme="dark"`, `previewPosition="none"`,
  `skinTonePosition="search"`, and the orange accent wired via emoji-mart CSS vars. Rendered inside
  a Base UI `Popover`. Props: `onSelect(native: string)`. Dynamically imported (`next/dynamic`,
  `ssr:false`) — the picker + dataset are client-only and heavy; must not bloat SSR/first paint.
- **Composer insert:** `RichTextEditor` gets an opt-in `showEmoji?: boolean`. When true, its toolbar
  shows an emoji button (a `Smile` icon) opening `EmojiPicker`; on select →
  `editor.chain().focus().insertContent(native).run()`. `CommentSection`'s editor passes `showEmoji`.
- **Reaction bar:** `features/comments/components/CommentReactions.tsx` under each `CommentItem`:
  - Chips per existing reaction: `<emoji> <count>`, highlighted (primary tint) when `reactedByMe`;
    click toggles via `toggleCommentReaction` + `router.refresh()`; `title`/tooltip lists `users`.
  - A trailing "＋" (`SmilePlus`) button opens `EmojiPicker` to add any reaction.
  - Empty state: just the "＋" affordance (no chips).
  - Gated to VIEWER+ implicitly (server enforces; the UI shows the affordance to anyone viewing —
    a VIEWER can react, matching the permission decision).

## Theming / performance
- emoji-mart is dynamically imported (`ssr:false`) so its ~large dataset never enters the server
  bundle or first paint. The picker mounts only when its Popover opens.
- Re-theme to tokens: dark theme + set `--em-rgb-accent`/border/background vars to the glass/orange
  palette so it doesn't ship default emoji-mart styling.
- Reaction toggles are optimistic-free (server action + `router.refresh()`), consistent with the
  existing comment/watch mutations.

## Security
- `toggleCommentReaction` validates input with Zod and authorises VIEWER+ on the comment's project;
  a user can only add/remove **their own** reaction (`userId` = session user, never client input).
- `emoji` is stored/rendered as text (a short unicode string), never HTML — no XSS surface. Cap its
  length in Zod.

## Tests
- `toggleCommentReaction`: creates on first call, deletes on repeat (toggle); VIEWER allowed;
  no-access (FORBIDDEN) rejected; emoji length cap.
- `getComments` reaction grouping: two users same emoji → count 2; `reactedByMe` true only for the
  session user's emoji.

## Sequencing (build parts)
1. `CommentReaction` model + migration + `toggleCommentReaction` action + Zod + tests. **[migration]**
2. Extend `getComments` to return grouped reactions + test.
3. emoji-mart dependency + themed `EmojiPicker` (dynamic, ssr:false) + composer insert button
   (`RichTextEditor` `showEmoji` opt-in, wired in `CommentSection`).
4. `CommentReactions` bar on `CommentItem` (chips + counts + who + picker), wired to the action.

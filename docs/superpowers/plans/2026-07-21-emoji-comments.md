# Emoji in Comments (Feature #1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert emojis into comment text via a picker, and react to comments with any emoji (counts, who reacted, toggle).

**Architecture:** New `CommentReaction` model + a `toggleCommentReaction` action (VIEWER+, own reaction only). `getComments` returns reactions grouped per comment. UI: emoji-mart picker (dynamic, ssr:false, themed) wired into the comment composer's toolbar and a reaction bar under each comment.

**Tech Stack:** Next.js 16, React 19, Prisma 7, Tiptap (existing `RichTextEditor`), Base UI Popover, emoji-mart, Vitest.

## Global Constraints

- TS strict — no `any`. Named exports (except page components).
- `toggleCommentReaction`: Zod-validate; authorise VIEWER+ on the comment's task project; the reaction is always the SESSION user's (`userId` never from client input). `emoji` stored/rendered as TEXT only (never HTML) — cap length in Zod.
- Prisma migrations only. Base UI `render={<Button/>}` (not Radix `asChild`). Tailwind tokens only.
- emoji-mart is dynamically imported (`next/dynamic`, `ssr:false`) so its large dataset never enters SSR/first paint; re-theme it to the dark/glass tokens (no default emoji-mart styling).
- Reuse the comments feature's existing `ActionResult`/`fail`/`mapAuthError` helpers. Run one test file with `npx vitest run <path>`.

---

### Task 1: `CommentReaction` model + `toggleCommentReaction` action (TDD)

**Files:**
- Modify: `prisma/schema.prisma` (new model + `Comment`/`User` relations)
- Modify/create: the comments feature's Zod schemas (add `reactionSchema`), `src/features/comments/actions.ts`, `src/features/comments/actions.test.ts` (add cases)

- [ ] **Step 1: Model + relations**

```prisma
model CommentReaction {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  emoji     String
  createdAt DateTime @default(now())

  comment Comment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([commentId, userId, emoji])
  @@index([commentId])
}
```
On `model Comment`, add `reactions CommentReaction[]`. On `model User`, add `commentReactions CommentReaction[]`.

- [ ] **Step 2: Migrate + regenerate**

Run: `npx prisma migrate dev --name comment_reaction` then `npx prisma generate` (explicit — bundled generate can no-op).

- [ ] **Step 3: Add `reactionSchema`**

Colocate with the comments feature's existing Zod schemas (the module `addComment` validates against — find it via `grep -rn "z.object" src/features/comments`). Add:
```ts
export const reactionSchema = z.object({
  commentId: z.string().min(1),
  emoji: z.string().min(1).max(32),
});
export type ReactionInput = z.infer<typeof reactionSchema>;
```

- [ ] **Step 4: Write the failing test** (append to `actions.test.ts` — mirror its existing mock setup)

```ts
// Add near the other imports:
import { toggleCommentReaction } from "./actions";
// The @/lib/db mock's `prisma` needs a `commentReaction` model with
// findUnique/create/delete and `comment.findUnique`. Add them to the mock's
// model set if not present.

describe("toggleCommentReaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireProjectRole as unknown as Mock).mockResolvedValue({ user: { id: "u1" }, role: "VIEWER" });
    db.comment.findUnique.mockResolvedValue({ task: { projectId: "p1" } });
  });

  it("creates the reaction on first toggle (VIEWER allowed)", async () => {
    db.commentReaction.findUnique.mockResolvedValue(null);
    db.commentReaction.create.mockResolvedValue({});
    const res = await toggleCommentReaction({ commentId: "c1", emoji: "👍" });
    expect(res).toEqual({ ok: true, data: { reacted: true } });
    expect(db.commentReaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { commentId: "c1", userId: "u1", emoji: "👍" } }),
    );
  });

  it("removes the reaction on repeat toggle", async () => {
    db.commentReaction.findUnique.mockResolvedValue({ id: "r1" });
    db.commentReaction.delete.mockResolvedValue({});
    const res = await toggleCommentReaction({ commentId: "c1", emoji: "👍" });
    expect(res).toEqual({ ok: true, data: { reacted: false } });
    expect(db.commentReaction.delete).toHaveBeenCalledOnce();
  });

  it("rejects a caller without project access", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    (requireProjectRole as unknown as Mock).mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    const res = await toggleCommentReaction({ commentId: "c1", emoji: "👍" });
    expect(res.ok).toBe(false);
    expect(db.commentReaction.create).not.toHaveBeenCalled();
  });
});
```

(Adapt `db`/`Mock` helper names to those already declared in `actions.test.ts`.)

- [ ] **Step 5: Run → FAIL** (`npx vitest run src/features/comments/actions.test.ts`)

- [ ] **Step 6: Implement `toggleCommentReaction`** (append to `actions.ts`, reusing its `fail`/`mapAuthError`)

```ts
export async function toggleCommentReaction(
  input: ReactionInput,
): Promise<ActionResult<{ reacted: boolean }>> {
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const { commentId, emoji } = parsed.data;
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { task: { select: { projectId: true } } },
    });
    if (!comment) return fail("Comment not found.");
    const { user } = await requireProjectRole(comment.task.projectId, "VIEWER");

    const existing = await prisma.commentReaction.findUnique({
      where: { commentId_userId_emoji: { commentId, userId: user.id, emoji } },
      select: { id: true },
    });
    if (existing) {
      await prisma.commentReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.commentReaction.create({ data: { commentId, userId: user.id, emoji } });
    }
    revalidatePath(`/projects/${comment.task.projectId}`, "layout");
    return { ok: true, data: { reacted: !existing } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}
```
(Add the `reactionSchema`/`ReactionInput` + `requireProjectRole` imports if the file doesn't already have them.)

- [ ] **Step 7: Run → PASS**, `npm run test` green, `npx tsc --noEmit` clean. Commit:

```bash
git add prisma/schema.prisma prisma/migrations src/features/comments
git commit -m "feat(comments): CommentReaction model + toggle action"
```

---

### Task 2: Return grouped reactions from `getComments` (TDD)

**Files:**
- Modify: `src/features/comments/queries.ts`, `src/features/comments/types.ts`
- Create: `src/features/comments/reactions.ts` (pure grouping helper) + `src/features/comments/reactions.test.ts`

**Interfaces:**
- Produces: `CommentReactionGroup = { emoji: string; count: number; reactedByMe: boolean; users: string[] }`; `groupReactions(rows, sessionUserId): CommentReactionGroup[]`; `CommentWithAuthor` gains `reactions: CommentReactionGroup[]`.

- [ ] **Step 1: Failing test for the pure grouper**

```ts
// src/features/comments/reactions.test.ts
import { describe, expect, it } from "vitest";
import { groupReactions } from "./reactions";

const rows = [
  { emoji: "👍", userId: "u1", user: { name: "Ann" } },
  { emoji: "👍", userId: "u2", user: { name: "Bob" } },
  { emoji: "🎉", userId: "u2", user: { name: "Bob" } },
];

describe("groupReactions", () => {
  it("groups by emoji with counts + reactor names", () => {
    const g = groupReactions(rows, "u1");
    const thumbs = g.find((r) => r.emoji === "👍");
    expect(thumbs).toEqual({ emoji: "👍", count: 2, reactedByMe: true, users: ["Ann", "Bob"] });
    expect(g.find((r) => r.emoji === "🎉")).toEqual({ emoji: "🎉", count: 1, reactedByMe: false, users: ["Bob"] });
  });
  it("reactedByMe is false when the session user didn't react", () => {
    expect(groupReactions(rows, "u9").every((r) => !r.reactedByMe)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `reactions.ts`

```ts
// src/features/comments/reactions.ts
export interface CommentReactionGroup {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: string[];
}

interface RawReaction { emoji: string; userId: string; user: { name: string } }

/** Group raw reaction rows (first-seen emoji order) into per-emoji summaries. */
export function groupReactions(rows: RawReaction[], sessionUserId: string): CommentReactionGroup[] {
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
```

- [ ] **Step 3: Run → PASS**

- [ ] **Step 4: Wire into `getComments` + `types.ts`**

- In `types.ts`, extend `CommentWithAuthor` so it carries `reactions: CommentReactionGroup[]` (import the type). If `CommentWithAuthor` is a raw `Prisma.CommentGetPayload`, redefine it as that payload **minus** the raw `reactions` relation **plus** the grouped `reactions` field (the query maps them).
- In `queries.ts` `getComments`: capture the user (`const { user } = await requireProjectRole(...)`), add to the `include` a `reactions: { select: { emoji: true, userId: true, user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }`, and `.map` each row to `{ ...row, reactions: groupReactions(row.reactions, user.id) }`.

- [ ] **Step 5: Typecheck** (`npx tsc --noEmit 2>&1 | grep comments || echo OK`) + `npm run test` green. Commit:

```bash
git add src/features/comments/queries.ts src/features/comments/types.ts src/features/comments/reactions.ts src/features/comments/reactions.test.ts
git commit -m "feat(comments): getComments returns grouped reactions"
```

---

### Task 3: emoji-mart picker + composer insert button

**Files:**
- Add dependency: `emoji-mart @emoji-mart/data @emoji-mart/react`
- Create: `src/features/comments/components/EmojiPicker.tsx`
- Modify: `src/components/editor/RichTextEditor.tsx` (opt-in `showEmoji`), `src/features/comments/components/CommentSection.tsx` (pass `showEmoji`)

- [ ] **Step 1: Install the dependency**

Run: `npm install emoji-mart @emoji-mart/data @emoji-mart/react`
Verify versions pin in `package.json`. (This is the approved new dependency.)

- [ ] **Step 2: `EmojiPicker.tsx`** (client; the heavy imports live here and the component is dynamically imported by callers so the dataset stays out of first paint)

```tsx
"use client";

import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

export interface EmojiPickerProps {
  onSelect: (native: string) => void;
}

/**
 * emoji-mart picker themed to the app's dark palette. Callers dynamic-import this
 * (`next/dynamic`, ssr:false) and render it inside a Popover so the ~large emoji
 * dataset only loads when the picker first opens.
 */
export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  return (
    <Picker
      data={data}
      theme="dark"
      previewPosition="none"
      skinTonePosition="search"
      navPosition="top"
      onEmojiSelect={(e: { native: string }) => onSelect(e.native)}
    />
  );
}
```

> emoji-mart React-19 note: `@emoji-mart/react`'s `Picker` mounts the vanilla picker
> via a ref/effect. If it throws under React 19, fall back to the `emoji-mart`
> package's class picker mounted into a `ref`'d div in a `useEffect` (documented in
> emoji-mart's README) — keep the same `{ onSelect }` prop. Verify it renders in the
> dev build before moving on.

Re-theme to tokens: in `globals.css` (or a scoped block), set emoji-mart's CSS custom
properties on the picker container to the glass/orange palette (e.g. `em-emoji-picker {
  --border-radius: 12px; --rgb-accent: 255 107 53; --rgb-background: 20 20 20; ... }`).
Match the surrounding popover; no default emoji-mart look.

- [ ] **Step 3: `RichTextEditor` opt-in emoji button**

- Add `showEmoji?: boolean` to the props interface.
- Add a lazy picker import at module top: `const EmojiPicker = dynamic(() => import("@/features/comments/components/EmojiPicker").then((m) => m.EmojiPicker), { ssr: false })` (import `dynamic` from `next/dynamic`).
- In the toolbar (where `ToolbarButton`s render — gate like the existing image button), when `showEmoji` render a Base UI `Popover`: `PopoverTrigger` = a `ToolbarButton`-styled button with a `Smile` icon (aria-label "Insert emoji"); `PopoverContent` renders `<EmojiPicker onSelect={(native) => { editor?.chain().focus().insertContent(native).run(); }} />`. Close the popover on select (control `open` state).
- Keep the `onMouseDown preventDefault` guard so opening the picker doesn't blur the editor.

- [ ] **Step 4: Enable in the composer**

In `CommentSection.tsx`, pass `showEmoji` to the composer `<RichTextEditor ... />`.

- [ ] **Step 5: Build + lint** (`npm run build && npm run lint`) → clean. Verify the picker opens + inserts in `npm run dev`. Commit:

```bash
git add package.json package-lock.json src/features/comments/components/EmojiPicker.tsx src/components/editor/RichTextEditor.tsx src/features/comments/components/CommentSection.tsx src/app/globals.css
git commit -m "feat(comments): emoji-mart picker + composer insert button"
```

---

### Task 4: Reaction bar on comments

**Files:**
- Create: `src/features/comments/components/CommentReactions.tsx`
- Modify: `src/features/comments/components/CommentItem.tsx` (render the bar), `CommentSection.tsx` (thread `currentUserId` if not already passed to items)

- [ ] **Step 1: `CommentReactions.tsx` (client)**

```tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { SmilePlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toggleCommentReaction } from "../actions";
import type { CommentReactionGroup } from "../reactions";
import { cn } from "@/lib/utils";

const EmojiPicker = dynamic(() => import("./EmojiPicker").then((m) => m.EmojiPicker), { ssr: false });

export interface CommentReactionsProps {
  commentId: string;
  reactions: CommentReactionGroup[];
}

export function CommentReactions({ commentId, reactions }: CommentReactionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  function react(emoji: string) {
    setOpen(false);
    startTransition(async () => {
      const res = await toggleCommentReaction({ commentId, emoji });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => react(r.emoji)}
          disabled={isPending}
          title={r.users.join(", ")}
          aria-pressed={r.reactedByMe}
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums outline-none transition-colors duration-150 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/50",
            r.reactedByMe
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-surface-raised",
          )}
        >
          <span aria-hidden>{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add reaction"
              disabled={isPending}
              className="text-muted-foreground hover:text-foreground"
            />
          }
        >
          <SmilePlus className="size-4" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto border-0 bg-transparent p-0 shadow-none">
          <EmojiPicker onSelect={react} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 2: Render under each comment**

In `CommentItem.tsx`, after the comment body/attachments block (inside the `min-w-0 flex-1` column), render:
```tsx
<CommentReactions commentId={comment.id} reactions={comment.reactions} />
```
(`comment.reactions` is now on `CommentWithAuthor` from Task 2.) Import `CommentReactions`.

- [ ] **Step 3: Build + lint** (`npm run build && npm run lint`) → clean. Manual: react to a comment (chip appears with count 1), react again (removed), a second user's reaction bumps the count, hover shows names. Commit:

```bash
git add src/features/comments/components/CommentReactions.tsx src/features/comments/components/CommentItem.tsx
git commit -m "feat(comments): emoji reaction bar on comments"
```

---

# Final verification

- [ ] **Full suite** — `npm run test` → all pass (new: toggle reaction, grouping).
- [ ] **Lint + build** — `npm run lint && npm run build` → clean.
- [ ] **Manual smoke** (`npm run dev`): comment composer emoji button inserts into the draft; posting keeps the emoji; the reaction bar toggles your reaction, shows counts + who; a VIEWER can react; the picker is themed (no default emoji-mart look) and only loads when opened.

---

## Notes for the implementer
- `emoji` is plain text end-to-end — never pass it through the HTML sanitiser or `dangerouslySetInnerHTML`.
- Keep emoji-mart lazy (`ssr:false` dynamic import); confirm the build output doesn't pull the emoji dataset into the main/shared chunk.
- If `@emoji-mart/react` fails under React 19, use the `emoji-mart` class picker in a ref/effect (same `onSelect` contract) — don't block the feature on the wrapper.
- Reaction mutation is the session user's own only; the server sets `userId` — never trust a client id.

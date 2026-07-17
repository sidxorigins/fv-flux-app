"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { RichTextEditor, type MentionItem } from "@/components/editor";
import { Button } from "@/components/ui/button";

import type { CommentWithAuthor } from "../types";
import { addComment } from "../actions";
import { isRichTextEmpty } from "../text";
import { CommentItem } from "./CommentItem";

export interface CommentSectionProps {
  taskId: string;
  comments: CommentWithAuthor[];
  currentUserId: string;
  /** MEMBER+ on this project — controls whether the composer is shown. */
  canComment: boolean;
  /**
   * Project MANAGER (or global Admin). Enables the delete affordance on OTHER
   * users' comments. The author always sees edit/delete for their own. Hidden UI
   * is never the security boundary — `actions.ts` re-checks on the server.
   */
  canManage?: boolean;
  /** Project members offered by the @-mention autocomplete in the composer. */
  mentionItems?: MentionItem[];
}

/**
 * Comment thread + composer for the task drawer. Compact, drawer-density
 * spacing. Server Components fetch `comments` (see queries.ts) and pass them in;
 * mutations run through Server Actions and refresh via `router.refresh()`.
 */
export function CommentSection({
  taskId,
  comments,
  currentUserId,
  canComment,
  canManage = false,
  mentionItems,
}: CommentSectionProps) {
  const router = useRouter();
  const [draft, setDraft] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const empty = isRichTextEmpty(draft);

  function submit() {
    if (pending || empty) return;
    const body = draft;
    setDraft(""); // optimistic clear
    startTransition(async () => {
      const res = await addComment({ taskId, body });
      if (!res.ok) {
        toast.error(res.error);
        setDraft(body); // restore so the user doesn't lose their text
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {comments.length > 0 ? (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <li key={comment.id}>
              <CommentItem
                comment={comment}
                canEdit={comment.authorId === currentUserId}
                canDelete={comment.authorId === currentUserId || canManage}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}

      {canComment ? (
        <div className="space-y-2">
          <RichTextEditor
            value={draft}
            onChange={setDraft}
            minHeight="80px"
            placeholder="Add a comment… use @ to mention someone"
            mentionItems={mentionItems}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={pending || empty}>
              {pending ? "Posting…" : "Comment"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RichTextContent, RichTextEditor } from "@/components/editor";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import type { CommentWithAuthor } from "../types";
import { deleteComment, updateComment } from "../actions";
import { isRichTextEmpty } from "../text";
import { TimeAgo } from "./TimeAgo";

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/** A comment considered "edited" once its update time is meaningfully after creation. */
function wasEdited(comment: CommentWithAuthor): boolean {
  return (
    new Date(comment.updatedAt).getTime() -
      new Date(comment.createdAt).getTime() >
    1000
  );
}

export function CommentItem({
  comment,
  canEdit,
  canDelete,
}: {
  comment: CommentWithAuthor;
  /** Author only — a manager cannot edit another user's words. */
  canEdit: boolean;
  /** Author or project manager. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(comment.body);
  const [pending, startTransition] = React.useTransition();

  function save() {
    if (pending || isRichTextEmpty(value)) return;
    startTransition(async () => {
      const res = await updateComment({ commentId: comment.id, body: value });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function cancel() {
    setValue(comment.body);
    setEditing(false);
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteComment({ commentId: comment.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex gap-2.5">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback className="text-[10px] font-medium">
          {initialsOf(comment.author.name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">
            {comment.author.name}
          </span>
          <TimeAgo
            date={comment.createdAt}
            className="shrink-0 text-xs text-muted-foreground"
          />
          {wasEdited(comment) ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              (edited)
            </span>
          ) : null}

          {(canEdit || canDelete) && !editing ? (
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="Edit comment"
                  onClick={() => setEditing(true)}
                >
                  <Pencil aria-hidden />
                </Button>
              ) : null}
              {canDelete ? (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-danger"
                        aria-label="Delete comment"
                      />
                    }
                  >
                    <Trash2 aria-hidden />
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This can&apos;t be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={remove}
                        disabled={pending}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
          ) : null}
        </div>

        {editing ? (
          <div className="space-y-2">
            <RichTextEditor
              value={value}
              onChange={setValue}
              minHeight="80px"
              placeholder="Edit comment…"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={pending || isRichTextEmpty(value)}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <RichTextContent html={comment.body} className="text-sm" />
        )}
      </div>
    </div>
  );
}

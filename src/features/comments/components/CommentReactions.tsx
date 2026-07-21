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

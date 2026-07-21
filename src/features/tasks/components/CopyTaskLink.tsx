"use client";

import * as React from "react";
import { Check, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { taskShareUrl } from "../share";

interface CopyTaskLinkProps {
  projectId: string;
  taskId: string;
  /** Accessible label / tooltip. */
  label?: string;
  className?: string;
}

/**
 * Copies a task's permalink (the `?task=` deep link) to the clipboard. Ghost
 * icon button reused across the task drawer, board cards, and backlog rows.
 *
 * `window.location.origin` is read at click time (SSR-safe), and the click is
 * fully contained (`stopPropagation` + `preventDefault`) so it never bubbles to
 * a parent card/row open handler or dnd listeners.
 */
export function CopyTaskLink({
  projectId,
  taskId,
  label = "Copy task link",
  className,
}: CopyTaskLinkProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onCopy(event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(
        taskShareUrl(window.location.origin, projectId, taskId),
      );
      setCopied(true);
      toast.success("Link copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  }

  const Icon = copied ? Check : Link2;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onCopy}
      aria-label={label}
      title={label}
      className={cn("text-muted-foreground", className)}
    >
      <Icon className={cn(copied && "text-success")} />
    </Button>
  );
}

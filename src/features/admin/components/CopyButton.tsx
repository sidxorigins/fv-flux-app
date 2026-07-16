"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  /** Accessible label / tooltip text. */
  label?: string;
  size?: "sm" | "icon-sm";
  className?: string;
}

/**
 * Copy-to-clipboard control. Uses `navigator.clipboard` with a sonner toast on
 * success and a brief inline check. Falls back to an error toast if the
 * clipboard API is unavailable or denied (e.g. non-secure context).
 */
export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  }

  const Icon = copied ? Check : Copy;

  if (size === "icon-sm") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onCopy}
        aria-label={label}
        className={cn("text-muted-foreground", className)}
      >
        <Icon className={cn(copied && "text-success")} />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onCopy}
      className={className}
    >
      <Icon className={cn(copied && "text-success")} />
      {copied ? "Copied" : label}
    </Button>
  );
}

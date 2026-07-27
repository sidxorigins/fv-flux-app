"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { grantAllProjectsViewer } from "../actions";

/**
 * One-click VIEWER grant across every project — for an EXECUTIVE whose Overview
 * lists every project but who can only open the ones they're a member of.
 * Idempotent and non-destructive: existing higher roles are never downgraded.
 */
export function GrantAllProjectsButton({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await grantAllProjectsViewer({ userId });
          if (result.ok) {
            toast.success(`${userName} can now view every project.`);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {isPending ? "Granting…" : "Grant viewer access to all projects"}
    </Button>
  );
}

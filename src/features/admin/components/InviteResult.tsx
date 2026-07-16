"use client";

import { CheckCircle2, Mail, MailWarning } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { CopyButton } from "./CopyButton";

interface InviteResultProps {
  inviteUrl: string;
  emailSent: boolean;
  /** Optional heading, e.g. "Invite sent" or "User created". */
  title?: string;
}

/**
 * Success panel shown after an invite / user-create. The invite link is ALWAYS
 * shown with a copy control (per the task brief), and the email-delivery status
 * tells the admin whether they still need to share the link manually (SMTP
 * unconfigured → the copy link is the delivery mechanism).
 */
export function InviteResult({ inviteUrl, emailSent, title }: InviteResultProps) {
  return (
    <div className="flex flex-col gap-3">
      {title ? (
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 aria-hidden className="size-4 text-success" />
          {title}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Set-password link
        </label>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={inviteUrl}
            aria-label="Set-password link"
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyButton value={inviteUrl} label="Copy link" />
        </div>
      </div>

      <p
        className={cn(
          "flex items-center gap-1.5 text-xs",
          emailSent ? "text-success" : "text-warning",
        )}
      >
        {emailSent ? (
          <>
            <Mail aria-hidden className="size-3.5" />
            Email sent to the recipient.
          </>
        ) : (
          <>
            <MailWarning aria-hidden className="size-3.5" />
            Email not sent (SMTP not configured) — share this link directly.
          </>
        )}
      </p>
    </div>
  );
}

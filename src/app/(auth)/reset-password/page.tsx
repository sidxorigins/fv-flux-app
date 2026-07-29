import type { Metadata } from "next";
import Link from "next/link";

import { validateResetToken } from "@/features/auth/actions";
import { ResetPasswordForm } from "@/features/auth/components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password — Flux",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

function InvalidLink() {
  return (
    <div className="flex flex-col gap-3 text-center">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        This reset link is invalid
      </h1>
      <p className="text-sm text-muted-foreground">
        It may have expired or already been used. Request a new one to try
        again.
      </p>
      <Link
        href="/forgot-password"
        className="text-sm font-medium text-primary hover:underline"
      >
        Request a new link
      </Link>
    </div>
  );
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) return <InvalidLink />;

  const { valid } = await validateResetToken(token);
  if (!valid) return <InvalidLink />;

  return <ResetPasswordForm token={token} />;
}

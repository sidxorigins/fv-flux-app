import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — Flux",
};

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const rawCallbackUrl = Array.isArray(params.callbackUrl)
    ? params.callbackUrl[0]
    : params.callbackUrl;

  return (
    <div className="flex flex-col gap-6">
      <LoginForm callbackUrl={rawCallbackUrl ?? null} />
      <p className="text-center text-sm text-muted-foreground">
        No open sign-up — you need an invite from an admin to join Flux.
      </p>
    </div>
  );
}

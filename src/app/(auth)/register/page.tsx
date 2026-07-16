import type { Metadata } from "next";

import { validateInviteToken } from "@/features/auth/actions";
import { RegisterForm } from "@/features/auth/components/RegisterForm";

export const metadata: Metadata = {
  title: "Create your account — Flux",
};

interface RegisterPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

function InvalidInvite({ expired }: { expired?: boolean }) {
  return (
    <div className="flex flex-col gap-2 text-center">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        This invite link is invalid
      </h1>
      <p className="text-sm text-muted-foreground">
        {expired ? "The link may have expired. " : ""}
        Contact an admin to request a new invite.
      </p>
    </div>
  );
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) {
    return <InvalidInvite />;
  }

  const invite = await validateInviteToken(token);

  if (!invite.valid) {
    return <InvalidInvite expired />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ve been invited to join Flux — set a username and password to finish.
        </p>
      </div>
      <RegisterForm token={token} email={invite.email ?? ""} />
    </div>
  );
}

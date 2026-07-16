import { redirect } from "next/navigation";

interface SetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

/**
 * v1 alias: admin-created accounts are delivered an invite-style
 * set-password link (see CLAUDE.md "Onboarding & Registration" §2). Rather
 * than duplicate the invite-acceptance flow, forward straight into
 * /register?token=… — same server-side token validation, same form. Revisit
 * only if set-password ever needs to diverge from register (e.g. a
 * different post-submit destination for existing users).
 */
export default async function SetPasswordPage({ searchParams }: SetPasswordPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  redirect(token ? `/register?token=${encodeURIComponent(token)}` : "/register");
}

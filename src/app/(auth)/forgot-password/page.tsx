import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/features/auth/components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password — Flux",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}

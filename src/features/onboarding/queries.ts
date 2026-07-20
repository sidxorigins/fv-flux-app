import "server-only";
import { requireUser } from "@/lib/permissions";

/** Whether the signed-in user has finished (or dismissed) the onboarding tour. */
export async function getTourState(): Promise<{ completed: boolean }> {
  const user = await requireUser();
  return { completed: user.tourCompletedAt !== null };
}

import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { stopTimerForUser } from "@/features/time/service";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);
  const { stopped } = await stopTimerForUser(auth.actor.id);
  return apiOk({ stopped });
}

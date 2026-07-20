import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { getRunningForUser } from "@/features/time/service";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);
  const running = await getRunningForUser(auth.actor.id);
  return apiOk({
    running: running ? { taskId: running.taskId, taskKey: running.taskKey, startedAt: running.startedAt } : null,
  });
}

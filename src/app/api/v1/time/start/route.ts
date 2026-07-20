import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { apiStartTimerSchema } from "@/features/api/schemas";
import { startTimerForUser } from "@/features/time/service";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "invalid_json", "Body must be valid JSON."); }
  const parsed = apiStartTimerSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "invalid_input", "taskId is required.");
  const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId }, select: { key: true } });
  if (!task) return apiError(404, "task_not_found", "Task not found.");
  const { stoppedTaskKey } = await startTimerForUser(auth.actor.id, parsed.data.taskId);
  return apiOk({ started: task.key, stoppedTaskKey });
}

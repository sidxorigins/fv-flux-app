import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { apiLogTimeSchema } from "@/features/api/schemas";
import { logTimeForUser } from "@/features/time/service";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "invalid_json", "Body must be valid JSON."); }
  const parsed = apiLogTimeSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.");
  const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId }, select: { id: true } });
  if (!task) return apiError(404, "task_not_found", "Task not found.");
  const entry = await logTimeForUser(auth.actor.id, parsed.data.taskId, parsed.data.minutes, {
    note: parsed.data.note, spentAt: parsed.data.spentAt,
  });
  return apiOk({ entry: { id: entry.id, taskId: parsed.data.taskId, minutes: parsed.data.minutes } }, { status: 201 });
}

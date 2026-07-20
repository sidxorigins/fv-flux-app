import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { apiUpdateTaskStatusSchema } from "@/features/api/schemas";
import { setTaskStatusForActor } from "@/features/tasks/service";

/**
 * PATCH /api/v1/tasks/{id} — update a task's status (GLOBAL scope; attributed to
 * the key's actor). Body: { status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" }.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_json", "Body must be valid JSON.");
  }
  const parsed = apiUpdateTaskStatusSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid status.");
  }

  const task = await setTaskStatusForActor(auth.actor.id, id, parsed.data.status);
  if (!task) return apiError(404, "task_not_found", "Task not found.");

  return apiOk({ task });
}

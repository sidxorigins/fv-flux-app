import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { apiListTasksQuerySchema, apiCreateTaskSchema } from "@/features/api/schemas";
import { createTaskCore } from "@/features/tasks/service";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);
  const url = new URL(request.url);
  const parsed = apiListTasksQuerySchema.safeParse({ projectId: url.searchParams.get("projectId") ?? "" });
  if (!parsed.success) return apiError(400, "invalid_query", "projectId is required.");
  const project = await prisma.project.findUnique({ where: { id: parsed.data.projectId }, select: { id: true } });
  if (!project) return apiError(404, "project_not_found", "Project not found.");
  const tasks = await prisma.task.findMany({
    where: { projectId: parsed.data.projectId, parentId: null },
    orderBy: { position: "asc" },
    take: 200,
    select: { id: true, key: true, title: true, status: true, priority: true },
  });
  return apiOk({ tasks });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "invalid_json", "Body must be valid JSON."); }
  const parsed = apiCreateTaskSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.");
  const { projectId, title, type, priority, assigneeId, description } = parsed.data;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return apiError(404, "project_not_found", "Project not found.");
  if (assigneeId) {
    const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true } });
    if (!u) return apiError(400, "assignee_not_found", "Assignee not found.");
  }

  const task = await prisma.$transaction((tx) =>
    createTaskCore(tx, auth.actor.id, {
      projectId, title, type, status: "TODO", priority,
      assigneeId: assigneeId ?? null, description: description ?? null,
    }),
  );
  return apiOk(
    { task: { id: task.id, key: task.key, title, status: "TODO", priority, assigneeId: assigneeId ?? null } },
    { status: 201 },
  );
}

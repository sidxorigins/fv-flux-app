import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { apiListTasksQuerySchema } from "@/features/api/schemas";

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

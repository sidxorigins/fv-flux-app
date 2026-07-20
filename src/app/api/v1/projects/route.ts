import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, key: true, name: true },
  });
  return apiOk({ projects });
}

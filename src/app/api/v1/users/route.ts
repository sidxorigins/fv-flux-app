import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";
import { apiOk, apiError } from "@/lib/api-response";
import { apiListUsersQuerySchema } from "@/features/api/schemas";

/**
 * GET /api/v1/users — the assignable-user directory, so an integration can
 * resolve an `assigneeId` before calling POST /tasks (which takes an id, not a
 * name or an email).
 *
 * SUSPENDED users are excluded — mirroring `listAssignableUsers()` in
 * features/admin/queries.ts, which is what the web app's assignee pickers use.
 * INVITED users are included: they hold a real row and can be assigned work
 * before they have finished registering, exactly as in the app.
 *
 * `email` is returned because resolving a person from an external system almost
 * always starts from their email address. It is org-internal directory data and
 * a key is already a global credential (see API.md "Key Scope"); no password
 * hash, token, or R2 key is ever selected here.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return apiError(auth.error.status, auth.error.code, auth.error.message);

  const url = new URL(request.url);
  const parsed = apiListUsersQuerySchema.safeParse({ q: url.searchParams.get("q") ?? undefined });
  if (!parsed.success) return apiError(400, "invalid_query", "q must be 200 characters or fewer.");

  const q = parsed.data.q?.trim();
  const users = await prisma.user.findMany({
    where: {
      status: { not: "SUSPENDED" },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { username: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, username: true, email: true, status: true },
  });

  return apiOk({ users });
}

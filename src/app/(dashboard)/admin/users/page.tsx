import { auth } from "@/lib/auth";
import { getProjects, searchUsers } from "@/features/admin/queries";
import { userSearchSchema } from "@/features/admin/schemas";
import { CreateUserDialog } from "@/features/admin/components/CreateUserDialog";
import { CursorPager } from "@/features/admin/components/CursorPager";
import { UsersTable } from "@/features/admin/components/UsersTable";
import { UsersToolbar } from "@/features/admin/components/UsersToolbar";

interface UsersPageProps {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}

export default async function AdminUsersPage({ searchParams }: UsersPageProps) {
  const raw = await searchParams;
  // Coerce/validate the URL params; ignore anything malformed.
  const parsed = userSearchSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : {};

  const session = await auth();
  const currentUserId = session?.user?.id ?? "";

  const [{ items, nextCursor }, projects] = await Promise.all([
    searchUsers(params),
    getProjects(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <UsersToolbar
          initialQuery={params.q ?? ""}
          initialStatus={params.status ?? null}
        />
        <div className="shrink-0">
          <CreateUserDialog
            projects={projects.map((p) => ({
              id: p.id,
              key: p.key,
              name: p.name,
            }))}
          />
        </div>
      </div>

      <UsersTable users={items} currentUserId={currentUserId} />
      <CursorPager nextCursor={nextCursor} hasCursor={Boolean(params.cursor)} />
    </div>
  );
}

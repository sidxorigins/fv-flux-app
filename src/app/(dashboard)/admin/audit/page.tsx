import { getAuditLog } from "@/features/admin/queries";
import { auditQuerySchema } from "@/features/admin/schemas";
import { AuditTable } from "@/features/admin/components/AuditTable";
import { AuditToolbar } from "@/features/admin/components/AuditToolbar";
import { CursorPager } from "@/features/admin/components/CursorPager";

interface AuditPageProps {
  searchParams: Promise<{ action?: string; actorId?: string; cursor?: string }>;
}

export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
  const raw = await searchParams;
  const parsed = auditQuerySchema.safeParse(raw);
  const params = parsed.success ? parsed.data : {};

  const { items, nextCursor } = await getAuditLog(params);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          Security-relevant events — invites, role changes, suspensions, and
          per-project access grants.
        </p>
        <div className="pt-1">
          <AuditToolbar initialAction={params.action ?? ""} />
        </div>
      </div>

      <AuditTable rows={items} />
      <CursorPager nextCursor={nextCursor} hasCursor={Boolean(params.cursor)} />
    </div>
  );
}

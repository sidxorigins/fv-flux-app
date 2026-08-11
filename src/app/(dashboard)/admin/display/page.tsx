import { getWallBoardUsers } from "@/features/admin/display/queries";
import { WallBoardUserList } from "@/features/admin/display/components/WallBoardUserList";

export const dynamic = "force-dynamic";

export default async function AdminDisplayPage() {
  const users = await getWallBoardUsers(); // requireAdmin() inside

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        Choose who appears on the office wall board at{" "}
        <code className="text-foreground font-mono text-xs">/display</code>. Hiding
        someone only affects that screen — it changes nothing about their access,
        role or tasks.
      </p>

      <WallBoardUserList users={users} />
    </div>
  );
}

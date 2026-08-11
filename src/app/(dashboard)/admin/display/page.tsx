import { RotationControl } from "@/features/admin/display/components/RotationControl";
import { WallBoardUserList } from "@/features/admin/display/components/WallBoardUserList";
import { getWallBoardUsers } from "@/features/admin/display/queries";
import { getRotationSeconds } from "@/features/admin/display/settings";

export const dynamic = "force-dynamic";

export default async function AdminDisplayPage() {
  // getWallBoardUsers runs requireAdmin(); the settings read is gated by it.
  const users = await getWallBoardUsers();
  const rotationSeconds = await getRotationSeconds();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        Choose who appears on the office wall board at{" "}
        <code className="text-foreground font-mono text-xs">/display</code>. Hiding
        someone only affects that screen — it changes nothing about their access,
        role or tasks.
      </p>

      <RotationControl seconds={rotationSeconds} />

      <WallBoardUserList users={users} />
    </div>
  );
}

import { getPendingInvites } from "@/features/admin/queries";
import { InvitesTable } from "@/features/admin/components/InvitesTable";
import { SendInviteDialog } from "@/features/admin/components/SendInviteDialog";

export default async function AdminInvitesPage() {
  const invites = await getPendingInvites();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {invites.length} pending {invites.length === 1 ? "invite" : "invites"}.
        </p>
        <SendInviteDialog />
      </div>
      <InvitesTable invites={invites} />
    </div>
  );
}

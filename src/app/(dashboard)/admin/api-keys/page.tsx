import { listApiKeys } from "@/features/admin/api-keys/queries";
import { listAssignableUsers } from "@/features/admin/queries";
import { ApiKeysManager } from "@/features/admin/components/ApiKeysManager";

export default async function AdminApiKeysPage() {
  const [keys, users] = await Promise.all([listApiKeys(), listAssignableUsers()]);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        API keys let external agents call <code>/api/v1</code> as a chosen user
        (global scope). Shown once at creation — store it safely.
      </p>
      <ApiKeysManager keys={keys} users={users} />
    </div>
  );
}

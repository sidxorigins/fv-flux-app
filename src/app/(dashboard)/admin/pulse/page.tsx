import { getOrgPulse } from "@/features/pulse/queries";
import { PulseKpiStrip } from "@/features/pulse/components/PulseKpiStrip";
import { PulseMemberCard } from "@/features/pulse/components/PulseMemberCard";

// Live board — never serve a cached render. Without this, Next would treat the
// page as static and the "working now" state could be minutes stale.
export const dynamic = "force-dynamic";

export default async function AdminPulsePage() {
  const pulse = await getOrgPulse(); // requireAdmin() inside — throws for non-admins

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Everyone active in Flux and what they&apos;re working on right now.
        </p>
        <span className="text-muted-foreground text-xs tabular-nums">
          as of{" "}
          {pulse.generatedAt.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <PulseKpiStrip kpis={pulse.kpis} />

      {pulse.members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active users yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pulse.members.map((member) => (
            <PulseMemberCard key={member.userId} member={member} />
          ))}
        </div>
      )}
    </div>
  );
}

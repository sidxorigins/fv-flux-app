// Pure, deterministic helpers pinned to the org timezone (single-org app based
// in Dubai; the prod box runs UTC, so raw server-local time would mislabel the
// time of day). Spec: 05–12 morning, 12–17 afternoon, else evening.

const ORG_TZ = "Asia/Dubai";

function dubaiHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ORG_TZ,
      hour: "numeric",
      hourCycle: "h23",
    }).format(date),
  );
}

export function greetingFor(date: Date): "morning" | "afternoon" | "evening" {
  const hour = dubaiHour(date);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

/** "Wednesday, 23 July" — the hero's date line, in org time. */
export function dubaiDateLine(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ORG_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")}`;
}

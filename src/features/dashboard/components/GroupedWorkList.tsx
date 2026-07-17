import { cn } from "@/lib/utils";
import type { GroupedWork } from "../work-buckets";
import { MyWorkList } from "./MyWorkList";

/**
 * "My work" as an urgency agenda: Overdue / Today / This week / Later / No due
 * date. Each non-empty bucket is a small tinted header + the existing MyWorkList
 * (which owns the inline status dropdown). Server component — no state of its
 * own; the interactive rows live inside MyWorkList.
 */
export function GroupedWorkList({ work }: { work: GroupedWork }) {
  if (work.total === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Nothing assigned to you — enjoy the calm.
      </p>
    );
  }

  const groups: {
    key: keyof GroupedWork;
    label: string;
    tint: string;
    tasks: GroupedWork[keyof GroupedWork];
  }[] = [
    { key: "overdue", label: "Overdue", tint: "text-danger", tasks: work.overdue },
    { key: "today", label: "Today", tint: "text-warning", tasks: work.today },
    { key: "thisWeek", label: "This week", tint: "text-foreground", tasks: work.thisWeek },
    { key: "later", label: "Later", tint: "text-muted-foreground", tasks: work.later },
    { key: "noDate", label: "No due date", tint: "text-muted-foreground", tasks: work.noDate },
  ];

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) =>
        Array.isArray(group.tasks) && group.tasks.length > 0 ? (
          <div key={group.key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <span
                className={cn(
                  "text-xs font-semibold tracking-wide uppercase",
                  group.tint,
                )}
              >
                {group.label}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {group.tasks.length}
              </span>
            </div>
            <MyWorkList tasks={group.tasks} />
          </div>
        ) : null,
      )}
    </div>
  );
}

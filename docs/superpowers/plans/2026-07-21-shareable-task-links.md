# Shareable Task Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-click "copy link" affordance on every task (drawer, board card, backlog rows) that copies the existing permission-gated deep link `${origin}/projects/${projectId}?task=${taskId}`.

**Architecture:** A pure `taskShareUrl(origin, projectId, taskId)` helper + a client `CopyTaskLink` component (ghost icon button; reads `window.location.origin` at click time; `stopPropagation`+`preventDefault` so it never opens the parent card/row or interferes with dnd; clipboard write + sonner toast). Wired into 4 render sites. No server/DB/routing changes — deep-link access is already gated on the project page.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Tailwind, Base UI `Button`, lucide-react (`Link2`, `Check`), sonner, Vitest + RTL.

## Global Constraints
- No `any` types. Named exports (except page components). Never hardcode colours — use tokens.
- Client component needs `"use client"`.
- `window.location.origin` read ONLY inside the click handler (SSR-safe) — never at module/render scope.
- The copy button MUST `event.stopPropagation()` AND `event.preventDefault()` at every placement — parent cards/rows use `onClick` to open the drawer, and the board card spreads dnd listeners.
- No new DB migration, no new server action, no new route. This feature is client-only.
- Reuse the existing clipboard/toast pattern from `src/features/admin/components/CopyButton.tsx` (brief `Check` for ~1.5s, `toast.success`, `toast.error` on failure, timer cleanup on unmount).

---

### Task 1: `taskShareUrl` helper + `CopyTaskLink` component + drawer wiring

**Files:**
- Create: `src/features/tasks/share.ts`
- Test: `src/features/tasks/share.test.ts`
- Create: `src/features/tasks/components/CopyTaskLink.tsx`
- Modify: `src/features/tasks/components/index.ts` (export `CopyTaskLink` if the barrel exports components)
- Modify: `src/features/tasks/components/TaskDetailPanel.tsx` (headerAction slot, ~line 444)

**Interfaces:**
- Produces: `taskShareUrl(origin: string, projectId: string, taskId: string): string`
- Produces: `CopyTaskLink({ projectId, taskId, className?, label? }): JSX.Element` (client)

- [ ] **Step 1: Write the failing test** — `src/features/tasks/share.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { taskShareUrl } from "./share";

describe("taskShareUrl", () => {
  it("builds the task deep link from origin + ids", () => {
    expect(taskShareUrl("https://flux.foodverse.io", "p1", "t1")).toBe(
      "https://flux.foodverse.io/projects/p1?task=t1",
    );
  });

  it("works for localhost origins (no trailing slash duplication)", () => {
    expect(taskShareUrl("http://localhost:3000", "proj_abc", "task_xyz")).toBe(
      "http://localhost:3000/projects/proj_abc?task=task_xyz",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/share.test.ts`
Expected: FAIL — cannot find module `./share`.

- [ ] **Step 3: Create the helper** — `src/features/tasks/share.ts`

```ts
/**
 * Absolute permalink for a task — the existing permission-gated deep link
 * (`/projects/<projectId>?task=<taskId>`) the app already routes on. Pure so it
 * is unit-testable; callers pass `window.location.origin` (client-only) as `origin`
 * so the copied link matches the host the user is actually on.
 */
export function taskShareUrl(
  origin: string,
  projectId: string,
  taskId: string,
): string {
  return `${origin}/projects/${projectId}?task=${taskId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/share.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `CopyTaskLink`** — `src/features/tasks/components/CopyTaskLink.tsx`

```tsx
"use client";

import * as React from "react";
import { Check, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { taskShareUrl } from "../share";

interface CopyTaskLinkProps {
  projectId: string;
  taskId: string;
  /** Accessible label / tooltip. */
  label?: string;
  className?: string;
}

/**
 * Copies a task's permalink (the `?task=` deep link) to the clipboard. Ghost
 * icon button reused across the task drawer, board cards, and backlog rows.
 *
 * `window.location.origin` is read at click time (SSR-safe), and the click is
 * fully contained (`stopPropagation` + `preventDefault`) so it never bubbles to
 * a parent card/row open handler or dnd listeners.
 */
export function CopyTaskLink({
  projectId,
  taskId,
  label = "Copy task link",
  className,
}: CopyTaskLinkProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onCopy(event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(
        taskShareUrl(window.location.origin, projectId, taskId),
      );
      setCopied(true);
      toast.success("Link copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  }

  const Icon = copied ? Check : Link2;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onCopy}
      aria-label={label}
      title={label}
      className={cn("text-muted-foreground", className)}
    >
      <Icon className={cn(copied && "text-success")} />
    </Button>
  );
}
```

- [ ] **Step 6: Export from the components barrel** (only if `index.ts` re-exports components)

Check `src/features/tasks/components/index.ts`. If it exports peer components (e.g. `TaskCard`, `WatchToggle` pattern), add:
```ts
export { CopyTaskLink } from "./CopyTaskLink";
```
If the barrel does not exist or does not export components, skip — import `CopyTaskLink` directly by relative path at each site.

- [ ] **Step 7: Wire into the drawer header** — `TaskDetailPanel.tsx`

Add the import (top, with the other component imports):
```tsx
import { CopyTaskLink } from "./CopyTaskLink"
```
Replace the `headerAction` prop (currently `headerAction={<WatchToggle taskId={task.id} watching={isWatching} />}`, ~line 444) with:
```tsx
headerAction={
  <div className="flex items-center gap-1">
    <CopyTaskLink projectId={task.projectId} taskId={task.id} />
    <WatchToggle taskId={task.id} watching={isWatching} />
  </div>
}
```
`task` here is `TaskDetail` (extends Prisma `Task`) so `task.projectId` is present.

- [ ] **Step 8: Verify build + lint + full test suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: clean typecheck, no new lint errors, all tests pass (share.test.ts included).

- [ ] **Step 9: Commit**

```bash
git add src/features/tasks/share.ts src/features/tasks/share.test.ts \
  src/features/tasks/components/CopyTaskLink.tsx \
  src/features/tasks/components/index.ts \
  src/features/tasks/components/TaskDetailPanel.tsx
git commit -m "feat: CopyTaskLink component + task-share URL helper + drawer copy-link"
```

---

### Task 2: Board card + backlog row (desktop + mobile) wiring

**Files:**
- Modify: `src/features/tasks/components/TaskCard.tsx`
- Modify: `src/features/tasks/components/BacklogView.tsx` (`TableRow` ~570 and `TaskRowCard` ~287)

**Interfaces:**
- Consumes: `CopyTaskLink` from `./CopyTaskLink` (Task 1); `BoardTask.projectId` (BoardTask extends Prisma `Task`).

- [ ] **Step 1: Board card** — `TaskCard.tsx`

Add import:
```tsx
import { CopyTaskLink } from "./CopyTaskLink"
```
In the top row (the `flex items-center gap-1.5` block holding `TypeIcon` + key + due date), insert the copy button as a trailing hover-revealed slot. The due-date span uses `ml-auto`; to avoid two `ml-auto` fighting, wrap the copy button so it sits after the due date at the far right, revealed on card hover:

Change the top row's closing so the copy button is the last child, e.g. after the due-date block add:
```tsx
        <CopyTaskLink
          projectId={task.projectId}
          taskId={task.id}
          className={cn(
            "-my-1 -mr-1 size-6 opacity-0 transition-opacity",
            "group-hover/card:opacity-100 focus-visible:opacity-100",
            "motion-reduce:transition-none",
            !dueDate && "ml-auto",
          )}
        />
```
Rationale: when there's no due date, `ml-auto` pushes the copy button right; when there IS a due date, the due span already holds `ml-auto` and the copy button follows it flush-right. The negative margins keep the 32px icon button from inflating the card's top row height. Verify the card's `group/card` class is on the root (it is) so `group-hover/card` triggers.

- [ ] **Step 2: Backlog desktop table row** — `BacklogView.tsx` (`TableRow` ~570)

Add import (with the other component imports):
```tsx
import { CopyTaskLink } from "./CopyTaskLink"
```
Add `group/row` to the `TableRow` className:
```tsx
className="group/row cursor-pointer outline-none focus-visible:bg-muted/50"
```
In the Title `TableCell` (~591), make the inner `span` fill the cell and append the copy button:
```tsx
<TableCell className="max-w-80">
  <span className="flex w-full items-center gap-1.5">
    <TypeIcon type={task.type} className="size-3.5 shrink-0" />
    <span className="truncate text-foreground">{task.title}</span>
    <CopyTaskLink
      projectId={task.projectId}
      taskId={task.id}
      className="ml-auto size-6 shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
    />
  </span>
</TableCell>
```
The button's own `stopPropagation` prevents the row `onClick={() => openTask(task.id)}`. No wrapping `TableCell` stopPropagation is needed (the button handles it), and no new column is added.

- [ ] **Step 3: Backlog mobile card** — `BacklogView.tsx` (`TaskRowCard` ~287)

In the top row (`flex items-start gap-2`, holding the checkbox, title block, and `AssigneeAvatar`), add the copy button before or after `AssigneeAvatar`:
```tsx
        <CopyTaskLink
          projectId={task.projectId}
          taskId={task.id}
          className="size-7 shrink-0"
        />
        <AssigneeAvatar user={task.assignee} />
```
(Mobile has no hover — show the button always. Its `stopPropagation` prevents the card root `onClick={onOpen}`.)

- [ ] **Step 4: Verify build + lint + tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: clean typecheck, no new lint errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/TaskCard.tsx src/features/tasks/components/BacklogView.tsx
git commit -m "feat: copy-link affordance on board cards + backlog rows"
```

---

## Self-Review notes
- Spec coverage: helper (T1 step 1-4), component (T1 step 5), drawer (T1 step 7), board card (T2 step 1), backlog desktop (T2 step 2), backlog mobile (T2 step 3) — all four render sites + the pure helper covered.
- No placeholders. `window.location.origin` guarded to click-time. `stopPropagation`+`preventDefault` at the single component, inherited by all 4 sites.
- Type consistency: `CopyTaskLinkProps` identical across T1/T2 usage; `projectId`/`taskId` are strings from Prisma `Task`.
- If `size="icon-sm"` renders larger than the surrounding chrome at a site, the per-site `className` (`size-6`/`size-7`) overrides it — keep it visually consistent with neighbours (Watch toggle, assignee avatar).

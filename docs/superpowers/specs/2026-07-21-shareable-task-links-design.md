# Design — Shareable Task Links (Feature #2)

Date: 2026-07-21
Branch: `feat/shareable-task-links`
Source: Flux_Proposed_New_Features.docx #2.

A one-click "copy link" affordance on every task, so a user can grab a
permalink and paste it in chat/comment/email. The app already deep-links tasks
via `/projects/<projectId>?task=<taskId>` (URL-driven drawer, permission-gated),
so this is purely a **copy-link affordance** — no new routing, no new server work.

---

## Locked decisions
- **URL shape:** the existing deep link — `${origin}/projects/${projectId}?task=${taskId}`.
  Built **client-side from `window.location.origin`** (not `NEXT_PUBLIC_APP_URL`) so the
  copied link always matches the host the user is actually on (prod, preview, localhost).
- **Placement: all three surfaces** — (1) task detail drawer header (beside Watch),
  (2) board task card (hover-revealed icon), (3) backlog row (desktop table row +
  mobile stacked card, hover-revealed icon).
- **No server changes.** Deep-link access is already gated: the project page loads
  `getTask(taskId)`, checks `task.projectId === projectId`, and `notFound()`s on
  `AuthorizationError`. A link to a task the recipient can't see simply won't open —
  the permalink itself leaks nothing (it's just `projectId` + `taskId`, both opaque cuids).
- **Copy UX:** `navigator.clipboard.writeText` + a sonner success toast ("Link copied"),
  mirroring the existing `features/admin/components/CopyButton.tsx` pattern (brief inline
  check icon, error toast on clipboard failure / non-secure context).

## Non-goals (v1)
- Short links / slugs / vanity URLs. Per-link access tokens or expiry. "Copied by X"
  analytics. Copying from anywhere other than the three surfaces above. A dedicated
  canonical `/tasks/<id>` route (the `?task=` deep link is the canonical URL).

---

## Components

### `taskShareUrl` (pure helper)
`src/features/tasks/share.ts`:
```ts
export function taskShareUrl(origin: string, projectId: string, taskId: string): string {
  return `${origin}/projects/${projectId}?task=${taskId}`;
}
```
Pure + unit-testable (no `window`). Callers pass `window.location.origin`.

### `CopyTaskLink` (client component)
`src/features/tasks/components/CopyTaskLink.tsx`:
- Props: `{ projectId: string; taskId: string; className?: string; label?: string }`.
- Renders a ghost `icon-sm` `Button` with a `Link2` (lucide) icon; `aria-label` =
  `label ?? "Copy task link"`.
- On click:
  1. `event.stopPropagation()` + `event.preventDefault()` — MUST NOT bubble to a
     parent card/row `onClick` (which would open the drawer) or to dnd listeners.
  2. `navigator.clipboard.writeText(taskShareUrl(window.location.origin, projectId, taskId))`.
  3. Success → brief `Check` icon (1.5s) + `toast.success("Link copied")`.
  4. Failure → `toast.error("Couldn't copy — copy it manually.")`.
- `window.location.origin` is read inside the click handler (never at module scope) so
  the component is SSR-safe.
- Cleans up its reset timer on unmount (same pattern as `CopyButton`).

We add a purpose-built component rather than reuse `CopyButton` because the value is
origin-dependent (only known client-side, at click time) and every placement needs the
`stopPropagation`/`preventDefault` guard — baking those in avoids repeating them at 3 sites.

## Wiring

1. **Drawer header** — `TaskDetailPanel.tsx`, the `headerAction` slot currently holds
   `<WatchToggle …/>`. Wrap both:
   ```tsx
   headerAction={
     <div className="flex items-center gap-1">
       <CopyTaskLink projectId={task.projectId} taskId={task.id} />
       <WatchToggle taskId={task.id} watching={isWatching} />
     </div>
   }
   ```
   (Confirm `task.projectId` is present on the drawer's task shape; if not, thread it
   from the page — it is already fetched there.)

2. **Board card** — `TaskCard.tsx`. The card root already has `group/card` and
   `BoardTask` carries `projectId`. Add a hover-revealed `CopyTaskLink` pinned
   top-right of the key/due row:
   `className="opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"`.
   Its `stopPropagation` keeps card-click (open) and dnd drag intact. Place it so it
   doesn't fight the due-date `ml-auto` (put the copy button in its own trailing slot).

3. **Backlog desktop row** — `BacklogView.tsx` `TableRow` (~570). Add `group/row` to the
   row `className`; inside the Title `TableCell`, append a hover-revealed `CopyTaskLink`
   (`ml-auto shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100`),
   making the title `span` `w-full` so `ml-auto` pins the button right within the cell.
   No new column (keeps header/body column counts aligned). `stopPropagation` prevents
   the row's `openTask`.

4. **Backlog mobile card** — `BacklogView.tsx` `TaskRowCard` (~287). Add `CopyTaskLink`
   in the top row beside `AssigneeAvatar`, `stopPropagation` (row root `onClick={onOpen}`).

## Security
- No new endpoint, no new data exposure. The permalink is `projectId` + `taskId` only;
  opening it runs the existing server-side permission gate. A `VIEWER`+ can copy a link;
  the recipient still needs their own access to open it.
- Nothing rendered as HTML — the URL is set via `clipboard.writeText` (text), never
  `dangerouslySetInnerHTML`.

## Tests
- `taskShareUrl`: builds the expected string for representative origin/ids; no trailing
  slash issues (origin has no trailing slash, path starts with `/`).
- (Component behaviour — click copies + stopPropagation — is covered by the helper test
  plus manual verification; a jsdom clipboard test is optional, not required.)

## Sequencing (build parts)
1. `taskShareUrl` helper + unit test; `CopyTaskLink` component; drawer-header wiring. **[no migration]**
2. Board card + backlog desktop row + backlog mobile card wiring (hover-reveal + stopPropagation).

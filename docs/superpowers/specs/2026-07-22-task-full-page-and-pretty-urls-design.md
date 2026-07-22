# Full-page task view + key-based URLs

**Date:** 2026-07-22
**Status:** Approved

## Goal

Give every task/subtask its own full page at a clean, Jira-style URL, reachable
by an expand button on the task drawer. Switch the app's task/project URLs from
internal cuids to human-readable keys, and keep existing cuid links working via
redirects.

## Decisions (locked)

- **Task page URL:** `/browse/EISC-9` (flat, global, task-key based — Jira-exact).
- **URL beautification scope:** keys everywhere — project pages become
  `/projects/EISC`, and the drawer param becomes `?task=EISC-9`.
- **Back-compat:** old cuid URLs redirect (301/`redirect()`) to the key form.
- **Full-page content reuse:** a separate `/browse` page that composes the
  already-shared section components; the drawer shell is left untouched. Both
  the drawer and the page drive the same Server Actions, so behavior can't drift.

## Non-goals (v1)

- No project-key rename/edit flow.
- No `/browse` index/list page.
- No refactor of `TaskDrawer` / `TaskDetailPanel` internals.
- No change to the `/api/v1/*` routes — they stay id-based.

## Facts grounding the design

- `Project.key` and `Task.key` are both `@unique` globally (schema lines 102, 159),
  so lookups are `findUnique({ where: { key } })` with no ambiguity.
- Keys are stored canonical/upper (e.g. `EISC`, `EISC-9`); the resolver uppercases
  the incoming segment before lookup.
- `src/features/tasks/share.ts` already centralizes task-link building
  (`taskShareUrl`) — it becomes the home for all URL helpers.
- Current deep link shape is `/projects/<cuid>?task=<cuid>`, generated at ~15 call
  sites (dashboard MyWork/ActivityFeed/ProjectTiles/Inbox, explore results,
  notifications inbox/bell/mentions, reminder + assignee emails, manager
  MemberActiveTasks, CopyTaskLink) and used in many `revalidatePath()` calls.

## 1. Routes & URL scheme

- **New** `src/app/(dashboard)/browse/[taskKey]/page.tsx`
  - Resolve `taskKey` (uppercased) → task via `findUnique`.
  - Permission-gate with the same `canViewProject` path the drawer uses.
  - 404 (`notFound()`) when missing or not permitted (do not leak existence).
- **Project page** `src/app/(dashboard)/projects/[projectId]` → treat the segment
  as the **project key**. Rename the dynamic segment to `[projectKey]` for clarity.
  Loader resolves key → project; `?task=EISC-9` still opens the drawer on top.
- **Drawer param** `?task=` now carries the **task key**.

## 2. Back-compat redirects

A shared resolver in `lib` (e.g. `lib/route-keys.ts`):

- `isCuid(segment)` — discriminates a Prisma cuid from a project/task key
  (keys are `[A-Z][A-Z0-9]*` / `KEY-<n>`; cuids are lowercase `c…` 25-char).
- Project page: if the `[projectKey]` segment is a cuid, look up the project and
  `redirect()` to `/projects/<KEY>` preserving the query string.
- Task drawer param: if `?task=` is a cuid, look up the task and `redirect()` to
  the same URL with `?task=<TASK_KEY>`.
- `/browse/[taskKey]`: if the segment is a cuid, `redirect()` to `/browse/<KEY>`.

All redirects preserve any other query params (filters, sort, saved view).

## 3. URL helpers + call-site sweep

In `share.ts` (pure, unit-tested):

- `projectPath(projectKey)` → `/projects/EISC`
- `taskDrawerPath(projectKey, taskKey, extraParams?)` → `/projects/EISC?task=EISC-9`
- `taskPagePath(taskKey)` → `/browse/EISC-9`
- `taskShareUrl(origin, taskKey)` → `${origin}/browse/EISC-9`
  (permalink now points at the full page)

Then:

- Replace every scattered `` `/projects/${id}?task=${id}` `` literal with a helper.
- Queries feeding those links must `select` `project.key` and `task.key` where they
  currently return only ids. Enumerate and patch each in implementation.
- `revalidatePath('/projects/<cuid>')` → `revalidatePath('/projects/<KEY>')` so the
  cache tag matches the real rendered route. Where only the id is in scope, fetch the
  key (already selected in most task queries) or revalidate by the resolved key.
- Emails (`reminders.ts`, `mentions.ts`, assignee notify in `actions.ts`) build the
  absolute URL from `NEXT_PUBLIC_APP_URL` + `taskPagePath(taskKey)`.

## 4. Full task page (`TaskPageView`, `'use client'`)

Two-column Jira-style layout:

- **Header:** breadcrumb `EISC / EISC-9`; parent backlink when the task is a subtask
  (same component/shape as the drawer's parent link); inline-editable title;
  type / status / priority controls; watch toggle; copy-link (now copies the
  `/browse` permalink).
- **Main column:** description (rich text, inline edit), subtasks list + add-subtask,
  comments.
- **Side column:** assignee, labels, due date, reporter (read-only), time, attachments,
  activity, watchers.
- Reuses existing `CommentSection`, `AttachmentSection`, `ActivityList`,
  `WatchersSection`, `TaskTimeSection` unchanged. Meta editors invoke the same
  Server Actions the drawer calls (`updateTask`, `updateTaskStatus`, `createTask`
  for subtasks, etc.).
- Data loaded server-side in `page.tsx` (task detail + comments + attachments +
  activity + watchers + time), mirroring the project page's drawer data assembly,
  then handed to `TaskPageView`.

## 5. Expand button

- In `TaskDrawer` header, next to the watch/copy controls, add a `⤢` expand icon
  (`Maximize2` or `SquareArrowOutUpRight` from lucide) as a `next/link` to
  `taskPagePath(task.key)`. Accessible label "Open full page".

## 6. Data / schema

- **No migration.** Keys already unique and present.
- Add `key` to the project/task `select` in the queries that feed links but omit it
  today (identified during the call-site sweep).

## 7. Testing

- **Unit:** `projectPath` / `taskDrawerPath` / `taskPagePath` / `taskShareUrl`
  helpers; `isCuid` discriminator (cuid vs `EISC` vs `EISC-9`).
- **Integration:** `/browse/EISC-9` renders and permission-gates (403/404 for a
  non-member); cuid → key redirect on project page, `?task=` param, and `/browse`;
  drawer opens from a key `?task=` param.

## 8. Rollout

- No migration → standard `deploy.sh` (rsync + build on box + `pm2 restart flux`).
- Old links keep working via §2, so no coordination needed with already-sent
  emails/notifications.

# Full-Page Task View + Key-Based URLs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every task/subtask its own full page at `/browse/EISC-9` reachable via an expand button on the drawer, and switch task/project URLs from cuids to human-readable keys with old links redirecting to the new form.

**Architecture:** New additive `/browse/[taskKey]` route renders a Jira-style full page composed from the existing shared section components (comments/attachments/activity/watchers/time), driven by the same Server Actions the drawer uses. Then project routing switches to the project **key** segment and the drawer `?task=` param switches to the task **key**, with cuid→key redirects for back-compat. `Project.key` and `Task.key` are both globally `@unique`, so lookups are `findUnique`.

**Tech Stack:** Next.js 16 (App Router, Server Components, Server Actions), React 19, Prisma, Vitest + RTL.

## Global Constraints

- TypeScript strict — no `any`.
- Server-first; add `'use client'` only for interactivity.
- Authorisation re-checked on the server via `canViewProject` for every task/project read; 404 (`notFound()`) on forbidden — never leak existence.
- Never hardcode the base URL — read `NEXT_PUBLIC_APP_URL`.
- Reference design tokens, not hex; Outfit font; `.glass` for chrome.
- Keys are canonical uppercase (`EISC`, `EISC-9`); resolvers uppercase the incoming segment before lookup.
- No schema migration — keys already exist and are unique.
- Named exports (except page components).

---

### Task 1: URL helpers + cuid/key discriminator

**Files:**
- Modify: `src/features/tasks/share.ts`
- Modify: `src/features/tasks/share.test.ts`

**Interfaces:**
- Produces:
  - `projectPath(projectKey: string): string` → `/projects/EISC`
  - `taskDrawerPath(projectKey: string, taskKey: string, extra?: URLSearchParams | Record<string,string>): string` → `/projects/EISC?task=EISC-9`
  - `taskPagePath(taskKey: string): string` → `/browse/EISC-9`
  - `taskShareUrl(origin: string, taskKey: string): string` → `${origin}/browse/EISC-9` (SIGNATURE CHANGED: was `(origin, projectId, taskId)`)
  - `isCuid(segment: string): boolean`

- [ ] **Step 1: Write failing tests**

Replace the body of `src/features/tasks/share.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  projectPath,
  taskDrawerPath,
  taskPagePath,
  taskShareUrl,
  isCuid,
} from "./share";

describe("url helpers", () => {
  it("projectPath uses the project key", () => {
    expect(projectPath("EISC")).toBe("/projects/EISC");
  });

  it("taskDrawerPath links to the project with a task key param", () => {
    expect(taskDrawerPath("EISC", "EISC-9")).toBe("/projects/EISC?task=EISC-9");
  });

  it("taskDrawerPath merges extra params", () => {
    expect(taskDrawerPath("EISC", "EISC-9", { view: "backlog" })).toBe(
      "/projects/EISC?view=backlog&task=EISC-9",
    );
  });

  it("taskPagePath is the flat browse route", () => {
    expect(taskPagePath("EISC-9")).toBe("/browse/EISC-9");
  });

  it("taskShareUrl is an absolute browse permalink", () => {
    expect(taskShareUrl("https://flux.foodverse.io", "EISC-9")).toBe(
      "https://flux.foodverse.io/browse/EISC-9",
    );
  });

  it("isCuid distinguishes cuids from keys", () => {
    expect(isCuid("cmrogf3wu0006pa705fts9z8o")).toBe(true);
    expect(isCuid("EISC")).toBe(false);
    expect(isCuid("EISC-9")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- src/features/tasks/share.test.ts`
Expected: FAIL (helpers not exported / signature mismatch).

- [ ] **Step 3: Implement helpers**

Replace `src/features/tasks/share.ts` with:

```ts
/**
 * URL helpers for tasks and projects. Pure so they are unit-testable and safe on
 * both server and client. All app-internal task/project links go through these —
 * do not hand-build `/projects/...` or `/browse/...` strings elsewhere.
 *
 * The app routes on human-readable keys: project key (e.g. `EISC`) and task key
 * (e.g. `EISC-9`), both globally unique. Callers pass keys, not cuids.
 */

/** `/projects/EISC` */
export function projectPath(projectKey: string): string {
  return `/projects/${projectKey}`;
}

/** `/projects/EISC?task=EISC-9`, merging any extra params before the task param. */
export function taskDrawerPath(
  projectKey: string,
  taskKey: string,
  extra?: URLSearchParams | Record<string, string>,
): string {
  const params = new URLSearchParams(extra);
  params.set("task", taskKey);
  return `${projectPath(projectKey)}?${params.toString()}`;
}

/** `/browse/EISC-9` — the full-page permalink. */
export function taskPagePath(taskKey: string): string {
  return `/browse/${taskKey}`;
}

/** Absolute permalink to a task's full page. `origin` is client-only (SSR-safe). */
export function taskShareUrl(origin: string, taskKey: string): string {
  return `${origin}${taskPagePath(taskKey)}`;
}

/**
 * True when a route segment is a Prisma cuid rather than a project/task key.
 * cuids are 25-char lowercase starting with `c`; keys are uppercase (`EISC`,
 * `EISC-9`). Used by route loaders to redirect legacy cuid URLs to the key form.
 */
export function isCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- src/features/tasks/share.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/share.ts src/features/tasks/share.test.ts
git commit -m "feat(tasks): key-based URL helpers + cuid discriminator"
```

---

### Task 2: Key-resolution query helpers

**Files:**
- Modify: `src/features/projects/queries.ts`
- Modify: `src/features/tasks/queries.ts`

**Interfaces:**
- Consumes: `isCuid` (Task 1), existing `getProject(id)`, `getTask(id)`, `canViewProject`.
- Produces:
  - `resolveProjectIdByKey(key: string): Promise<string | null>` — cuid for a project key (uppercased), or null. NO auth check (callers gate via `getProject`).
  - `resolveTaskIdByKey(key: string): Promise<string | null>` — cuid for a task key (uppercased), or null. NO auth check.

These let route loaders turn a key segment into the id that `getProject`/`getTask` already accept, and turn a legacy cuid into its key for redirects (via the existing rows).

- [ ] **Step 1: Add project resolver**

In `src/features/projects/queries.ts`, add (near `getProject`):

```ts
/**
 * Look up a project's cuid by its unique key (case-insensitive). Returns null if
 * no such project. Does NOT check access — callers pass the id to `getProject`,
 * which enforces `canViewProject`.
 */
export async function resolveProjectIdByKey(key: string): Promise<string | null> {
  const row = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
    select: { id: true },
  });
  return row?.id ?? null;
}
```

- [ ] **Step 2: Add task resolver**

In `src/features/tasks/queries.ts`, add (near `getTask`):

```ts
/**
 * Look up a task's cuid by its unique key (case-insensitive, e.g. "EISC-9").
 * Returns null if no such task. Does NOT check access — callers pass the id to
 * `getTask`, which enforces `canViewProject`.
 */
export async function resolveTaskIdByKey(key: string): Promise<string | null> {
  const row = await prisma.task.findUnique({
    where: { key: key.toUpperCase() },
    select: { id: true },
  });
  return row?.id ?? null;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/projects/queries.ts src/features/tasks/queries.ts
git commit -m "feat: resolve project/task cuid by unique key"
```

---

### Task 3: `/browse/[taskKey]` full page + expand button (additive — no existing URL changes yet)

This is the headline feature and is purely additive: the new route and the expand
button. Existing `?task=<cuid>` drawer flow is untouched, so the app keeps working.

**Files:**
- Create: `src/app/(dashboard)/browse/[taskKey]/page.tsx`
- Create: `src/features/tasks/components/TaskPageView.tsx`
- Modify: `src/features/tasks/components/index.ts` (export `TaskPageView`)
- Modify: `src/features/tasks/components/TaskDrawer.tsx` (expand button in header)

**Interfaces:**
- Consumes: `resolveTaskIdByKey` (Task 2), `isCuid` + `taskPagePath` (Task 1), `getTask`, `getComments`, `getAttachments`, `getTaskActivity`, `getTaskWatchers`, `isWatchingTask`, `getTaskTime`, `getRunningTimer`, `getProjectMembers`, `listAssignableUsersForProject`, `getProjectLabels`, and the section components (`CommentSection`, `AttachmentSection`, `ActivityList`, `WatchersSection`, `TaskTimeSection`), plus the task Server Actions (`updateTask`, `updateTaskStatus`, `deleteTask`, `createTask`).
- Produces: the `/browse/EISC-9` route + `TaskPageView` client component.

- [ ] **Step 1: Create the page loader**

Create `src/app/(dashboard)/browse/[taskKey]/page.tsx`. Mirror the drawer-data assembly in `src/app/(dashboard)/projects/[projectId]/page.tsx:288-317`. Resolve the key → id, redirect a cuid segment to its key, gate with `getTask` (throws/nulls on no access → `notFound()`):

```tsx
import { notFound, redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { AuthorizationError, PROJECT_ROLE_ORDER } from "@/lib/permissions"
import type { ProjectRole } from "@/generated/prisma/enums"

import { getAttachments } from "@/features/attachments/queries"
import { getComments } from "@/features/comments/queries"
import {
  getProjectMembers,
  listAssignableUsersForProject,
} from "@/features/admin/queries"
import { getTaskActivity } from "@/features/tasks/activity"
import { getTaskWatchers, isWatchingTask } from "@/features/notifications/queries"
import { getTaskTime, getRunningTimer } from "@/features/time/queries"
import { getProject } from "@/features/projects/queries"
import { getProjectLabels, getTask, resolveTaskIdByKey } from "@/features/tasks/queries"
import { isCuid, taskPagePath } from "@/features/tasks/share"
import { TaskPageView } from "@/features/tasks/components"

interface BrowsePageProps {
  params: Promise<{ taskKey: string }>
}

export default async function BrowseTaskPage({ params }: BrowsePageProps) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { taskKey } = await params

  // Legacy cuid link → redirect to the pretty key URL.
  if (isCuid(taskKey)) {
    const row = await import("@/lib/db").then(({ prisma }) =>
      prisma.task.findUnique({ where: { id: taskKey }, select: { key: true } }),
    )
    if (row) redirect(taskPagePath(row.key))
    notFound()
  }

  const taskId = await resolveTaskIdByKey(taskKey)
  if (!taskId) notFound()

  let task
  try {
    task = await getTask(taskId)
  } catch (err) {
    if (err instanceof AuthorizationError) {
      if (err.code === "UNAUTHENTICATED") redirect("/login")
      notFound()
    }
    throw err
  }
  if (!task) notFound()

  const [comments, attachments, activity, isWatching, watchers, taskTime, runningTimer] =
    await Promise.all([
      getComments(taskId),
      getAttachments(taskId),
      getTaskActivity(taskId),
      isWatchingTask(taskId),
      getTaskWatchers(taskId),
      getTaskTime(taskId),
      getRunningTimer(),
    ])

  // Permission resolution mirrors the project page.
  let project
  try {
    project = await getProject(task.projectId)
  } catch {
    notFound()
  }
  if (!project) notFound()

  const isAdmin = session.user.globalRole === "ADMIN"
  const membership = project.memberships.find((m) => m.userId === session.user.id)
  const myRole: ProjectRole = isAdmin
    ? "MANAGER"
    : (membership?.projectRole ?? "VIEWER")
  const canEdit = PROJECT_ROLE_ORDER[myRole] >= PROJECT_ROLE_ORDER.MEMBER
  const canManage = PROJECT_ROLE_ORDER[myRole] >= PROJECT_ROLE_ORDER.MANAGER
  const members = project.memberships.map((m) => m.user)
  const projectLabels = await getProjectLabels(task.projectId)

  return (
    <TaskPageView
      task={task}
      projectKey={project.key}
      projectName={project.name}
      comments={comments}
      attachments={attachments}
      activity={activity}
      isWatching={isWatching}
      watchers={watchers}
      taskTime={taskTime}
      runningTimer={runningTimer}
      members={members}
      projectLabels={projectLabels}
      currentUserId={session.user.id}
      canEdit={canEdit}
      canManage={canManage}
    />
  )
}
```

- [ ] **Step 2: Create `TaskPageView`**

Create `src/features/tasks/components/TaskPageView.tsx` as a `'use client'` component. It mirrors the state/handlers in `TaskDetailPanel.tsx` (read that file for the exact handler bodies: `onStatusChange`, `onPriorityChange`, description save, `addSubtask`, `navigateToTask`, `confirmDelete`) but renders a two-column **page** layout instead of a drawer, and navigates with `taskPagePath`/`router.push` rather than the `?task=` param.

Props interface (match `TaskDetailPanelProps` in `TaskDetailPanel.tsx:51-81`, minus the drawer `onOpenChange`, plus `projectKey`/`projectName`):

```tsx
"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { TaskDetail } from "../queries"
import type { CommentWithAuthor } from "@/features/comments/types"
import type { AttachmentWithUploader } from "@/features/attachments/types"
import type { ActivityEntry } from "@/features/tasks/activity"
import type { TaskWatcherItem } from "@/features/notifications/queries"
import type { RunningTimer, TaskTime } from "@/features/time/queries"

import { projectPath, taskPagePath } from "../share"
import { createTask, updateTask, updateTaskStatus } from "../actions"
import { StatusBadge } from "./StatusBadge"
import { TypeIcon } from "./TypeIcon"
import { CommentSection } from "@/features/comments/components/CommentSection"
import { AttachmentSection } from "@/features/attachments/components/AttachmentSection"
import { ActivityList } from "./ActivityList"
import { WatchersSection } from "@/features/notifications/components/WatchersSection"
import { TaskTimeSection } from "@/features/time/components/TaskTimeSection"
// ...import the exact same section components TaskDetailPanel/TaskDrawer use;
// verify each import path against TaskDetailPanel.tsx and TaskDrawer.tsx.

interface TaskPageViewProps {
  task: TaskDetail
  projectKey: string
  projectName: string
  comments: CommentWithAuthor[]
  attachments: AttachmentWithUploader[]
  activity: ActivityEntry[]
  isWatching: boolean
  watchers: TaskWatcherItem[]
  taskTime: TaskTime
  runningTimer: RunningTimer | null
  members: { id: string; name: string; username: string; image: string | null }[]
  projectLabels: { id: string; name: string; color: string }[]
  currentUserId: string
  canEdit: boolean
  canManage: boolean
}

export function TaskPageView(props: TaskPageViewProps) {
  const { task, projectKey, projectName, canEdit } = props
  const router = useRouter()

  // Reuse the handler bodies from TaskDetailPanel.tsx verbatim, swapping any
  // `?task=` navigation for taskPagePath():
  function navigateToTask(taskKey: string) {
    router.push(taskPagePath(taskKey))
  }
  // ...onStatusChange / onPriorityChange / addSubtask / description save:
  //    copy from TaskDetailPanel.tsx, calling the same server actions and
  //    router.refresh() on success (identical logic).

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href={projectPath(projectKey)} className="hover:text-foreground">
          {projectName}
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono text-foreground">{task.key}</span>
      </nav>

      {/* Parent backlink (subtask → parent) */}
      {task.parent ? (
        <button
          type="button"
          onClick={() => navigateToTask(task.parent!.key)}
          className="mb-3 flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-raised"
        >
          {/* same content as TaskDetailPanel parentLink */}
          <TypeIcon type={task.parent.type} className="size-3.5 shrink-0" />
          <span className="font-mono text-xs text-muted-foreground">{task.parent.key}</span>
          <span className="truncate text-sm">{task.parent.title}</span>
        </button>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <main className="min-w-0 space-y-6">
          <h1 className="text-2xl font-semibold text-foreground">{task.title}</h1>
          {/* description block: copy the description-edit JSX from TaskDetailPanel */}
          {/* subtasks list + add-subtask input: copy from TaskDetailPanel */}
          <CommentSection
            taskId={task.id}
            comments={props.comments}
            currentUserId={props.currentUserId}
            canComment={canEdit}
            canManage={props.canManage}
            mentionItems={props.members
              .filter((m) => m.id !== props.currentUserId)
              .map((m) => ({ id: m.username, name: m.name }))}
          />
        </main>

        <aside className="space-y-6">
          {/* status / priority / assignee / labels / due date meta editors:
              reuse the same controls TaskDrawer renders (status & priority
              dropdowns calling updateTaskStatus / updateTask). For v1 you may
              render them via the existing editor sub-components used by the
              drawer if they are exported; otherwise compose minimal controls
              calling the same actions. */}
          <TaskTimeSection
            taskId={task.id}
            time={props.taskTime}
            running={props.runningTimer}
            canLog={canEdit}
            currentUserId={props.currentUserId}
          />
          <AttachmentSection
            taskId={task.id}
            attachments={props.attachments}
            currentUserId={props.currentUserId}
            canUpload={canEdit}
            canManage={props.canManage}
          />
          <WatchersSection
            taskId={task.id}
            watchers={props.watchers}
            members={props.members}
            canManage={canEdit}
            currentUserId={props.currentUserId}
          />
          {props.activity.length > 0 ? <ActivityList entries={props.activity} /> : null}
        </aside>
      </div>
    </div>
  )
}
```

Implementation notes for the executor:
- Open `src/features/tasks/components/TaskDetailPanel.tsx` and copy the handler bodies (`onStatusChange`, `onPriorityChange`, description save state + `saveDescription`/`cancelDescription`, `addSubtask`) and the description/subtasks JSX **verbatim**, changing only navigation to `taskPagePath`. This keeps behavior identical and avoids drift (both call the same Server Actions).
- Verify every section-component import path and prop shape against how `TaskDetailPanel.tsx` / `TaskDrawer.tsx` import and use them (they are the source of truth).
- Re-theme to tokens (`text-foreground`, `bg-surface`, `.glass` where a panel is warranted). No hardcoded hex.

- [ ] **Step 3: Export `TaskPageView`**

In `src/features/tasks/components/index.ts`, add:

```ts
export { TaskPageView } from "./TaskPageView"
```

- [ ] **Step 4: Add the expand button to the drawer**

In `src/features/tasks/components/TaskDrawer.tsx`, import `Link` from `next/link`, `SquareArrowOutUpRight` from `lucide-react`, and `taskPagePath` from `../share`. In the header controls (the `headerAction` cluster, alongside the existing close button around line 392), add before `headerAction`:

```tsx
<Link
  href={taskPagePath(task.key)}
  aria-label="Open full page"
  title="Open full page"
  className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
>
  <SquareArrowOutUpRight className="size-4" aria-hidden />
</Link>
```

(`task` here is the `BoardTask` the drawer already renders — it has `key`.)

- [ ] **Step 5: Verify build + manual smoke**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.
Manual: `npm run dev`, open a task drawer, click expand → lands on `/browse/<KEY>` showing the task; a subtask page shows the parent backlink; comments/attachments/activity render.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/browse src/features/tasks/components/TaskPageView.tsx src/features/tasks/components/index.ts src/features/tasks/components/TaskDrawer.tsx
git commit -m "feat(tasks): full-page task view at /browse/<key> + drawer expand button"
```

---

### Task 4: Switch project route to the project key + fix BoardView

**Files:**
- Rename dir: `src/app/(dashboard)/projects/[projectId]/` → `src/app/(dashboard)/projects/[projectKey]/`
- Modify: the project `page.tsx` (loader resolves key, redirects cuid) and any sibling files in that dir referencing `params.projectId`
- Modify: `src/features/tasks/components/BoardView.tsx` (take `projectId` as a prop, not from `useParams`)

**Interfaces:**
- Consumes: `resolveProjectIdByKey`, `isCuid`, `projectPath` (Tasks 1–2).
- Produces: `/projects/EISC` routing; `BoardView` gains a required `projectId: string` prop.

- [ ] **Step 1: Rename the route segment directory**

```bash
git mv "src/app/(dashboard)/projects/[projectId]" "src/app/(dashboard)/projects/[projectKey]"
```

- [ ] **Step 2: Resolve key → id + redirect cuid in the loader**

In the moved `page.tsx`, change the params type to `{ projectKey: string }` and, at the top of the component (before `getProject`), translate the segment to a project id:

```tsx
const { projectKey: projectSegment } = await params

if (isCuid(projectSegment)) {
  const row = await prisma.project.findUnique({
    where: { id: projectSegment },
    select: { key: true },
  })
  if (!row) notFound()
  // preserve the query string on redirect
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x))
    else if (v) qs.set(k, v)
  }
  const q = qs.toString()
  redirect(q ? `${projectPath(row.key)}?${q}` : projectPath(row.key))
}

const projectId = await resolveProjectIdByKey(projectSegment)
if (!projectId) notFound()
```

Then use `projectId` everywhere the loader previously used the raw segment (the `getProject(projectId)`, `getProjectLabels(projectId)`, `getProjectMembers`, etc. calls already take `projectId` — just ensure they receive this resolved value). Add the imports: `resolveProjectIdByKey` from tasks/projects queries, `isCuid`/`projectPath` from `@/features/tasks/share`, and `prisma` from `@/lib/db`. `sp` is the already-awaited `searchParams` object in this file.

- [ ] **Step 3: Pass the real project id into BoardView**

`BoardView` currently reads `const { projectId } = useParams<{ projectId: string }>()` (line 36) — that segment is now the KEY, which would break `createTask({ projectId })`. In the project `page.tsx`, find where `<BoardView ... />` is rendered and pass `projectId={projectId}` (the resolved cuid). Then in `src/features/tasks/components/BoardView.tsx`:
  - Add `projectId: string` to its props interface.
  - Delete the `useParams` read of `projectId` (keep `usePathname`/`useRouter` if used elsewhere).
  - Use the prop.

- [ ] **Step 4: Fix sibling references**

Search the moved directory for any remaining `params.projectId` / `useParams<{ projectId` and update to `projectKey` semantics (they should route through the resolved `projectId` prop or the loader). Command:

```bash
grep -rn "projectId" "src/app/(dashboard)/projects/[projectKey]"
```

Update each so client components that call Server Actions receive the resolved cuid, not the key segment.

- [ ] **Step 5: Update internal links to projects to use the key**

`ProjectTiles.tsx` and the project list link to `/projects/<id>`. Update them to `projectPath(project.key)` (ensure those queries select `key`). Command to find:

```bash
grep -rn "/projects/\${" src/features src/app | grep -v "\[projectKey\]"
```

For each, switch to `projectPath(<key>)` / `taskDrawerPath(...)`. If a query feeding the link lacks `key`, add it to the `select`.

- [ ] **Step 6: Build + manual**

Run: `npx tsc --noEmit && npm run build`
Manual: visit `/projects/EISC` (renders board); visit an old `/projects/<cuid>` (301s to `/projects/EISC`); board quick-add still creates tasks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(projects): key-based project route /projects/<KEY> + cuid redirect"
```

---

### Task 5: Switch the drawer `?task=` param to the task key

**Files:**
- Modify: project `page.tsx` (resolve `?task=` key → task; redirect cuid)
- Modify: `src/features/tasks/components/TaskDetailPanel.tsx` (`navigateToTask`, parent/subtask links use keys)
- Modify: `src/features/tasks/components/BacklogView.tsx` (open-drawer nav uses key)

**Interfaces:**
- Consumes: `resolveTaskIdByKey`, `isCuid`, `taskDrawerPath` (Tasks 1–2).

- [ ] **Step 1: Resolve the `?task=` param in the project loader**

In the project `page.tsx`, where it currently does `const taskId = asString(sp.task) ?? null` and later `getTask(taskId)`: treat `sp.task` as a KEY. Add:

```tsx
const taskParam = asString(sp.task) ?? null
let taskId: string | null = null
if (taskParam) {
  if (isCuid(taskParam)) {
    const row = await prisma.task.findUnique({
      where: { id: taskParam },
      select: { key: true },
    })
    if (row) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(sp)) {
        if (k === "task") continue
        if (Array.isArray(v)) v.forEach((x) => qs.append(k, x))
        else if (v) qs.set(k, v)
      }
      redirect(taskDrawerPath(project.key, row.key, qs))
    }
    // unknown cuid → just don't open a drawer
  } else {
    taskId = await resolveTaskIdByKey(taskParam)
  }
}
```

Keep the existing `getTask(taskId)` guarded block. (`project.key` is available after `getProject`.)

- [ ] **Step 2: Drawer navigation uses keys**

In `TaskDetailPanel.tsx`:
  - `navigateToTask(taskKey)` — change `params.set("task", taskKey)` to set the KEY, and update its two callers (parent link `task.parent!.key`, subtask `subtask.key`) to pass keys instead of ids.

In `BacklogView.tsx` (line ~431 `params.set("task", taskId)`): pass the task's KEY.

- [ ] **Step 3: Build + manual**

Run: `npx tsc --noEmit && npm run build`
Manual: click a backlog row → URL shows `?task=EISC-9`, drawer opens; parent/subtask links keep the key form; an old `?task=<cuid>` 301s to the key form.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(tasks): drawer ?task= uses task key + cuid redirect"
```

---

### Task 6: Call-site sweep — all task deep links via helpers, share URL → /browse

**Files (each generates a task deep link today — replace the literal with a helper and ensure the feeding query selects `project.key`/`task.key`):**
- `src/features/tasks/components/CopyTaskLink.tsx`
- `src/features/tasks/actions.ts:157` (assignee-notify email URL)
- `src/features/notifications/mentions.ts:91`
- `src/features/notifications/reminders.ts` (email link)
- `src/features/dashboard/components/MyWorkList.tsx:88`
- `src/features/dashboard/components/ActivityFeed.tsx:141`
- `src/features/dashboard/components/InboxPanel.tsx:40`
- `src/features/notifications/components/InboxList.tsx:52`
- `src/features/notifications/components/NotificationBell.tsx:42`
- `src/features/notifications/components/` (any other `?task=` push)
- `src/features/explore/components/ExploreResults.tsx:87`
- `src/features/manager/components/MemberActiveTasks.tsx:136`

**Interfaces:**
- Consumes: `taskDrawerPath`, `taskPagePath`, `taskShareUrl`, `projectPath` (Task 1).

- [ ] **Step 1: Update `CopyTaskLink`**

Change props from `{ projectId, taskId }` to `{ taskKey }`; update the copy call to `taskShareUrl(window.location.origin, taskKey)`. Update every `<CopyTaskLink .../>` usage (drawer at `TaskDetailPanel.tsx:477`, board cards, backlog rows) to pass `taskKey={task.key}`.

- [ ] **Step 2: In-app navigation links → `taskDrawerPath` or `taskPagePath`**

For each dashboard/explore/manager/notification link currently building `` `/projects/${projectId}?task=${taskId}` ``, replace with `taskDrawerPath(projectKey, taskKey)` (keep drawer UX) — EXCEPT where a full page is clearly better (optional). Ensure each feeding query (`MyWorkList`, `ActivityFeed`, `InboxPanel`, `ExploreResults`, `MemberActiveTasks`, notification queries) selects `project.key` and `task.key`. For notification `router.push` handlers, the notification row needs the project key + task key — extend `getNotifications`/inbox queries to include them.

- [ ] **Step 3: Email URLs → `taskPagePath`**

In `tasks/actions.ts`, `mentions.ts`, `reminders.ts`, replace `` `${base}/projects/${projectId}?task=${taskId}` `` with `` `${base}${taskPagePath(taskKey)}` ``. These queries already load the task; ensure `task.key` is selected.

- [ ] **Step 4: Build + tests**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: green. Fix any query missing `key` in its `select`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: route every task/project deep link through key-based URL helpers"
```

---

### Task 7: `revalidatePath` sweep → dynamic route pattern

**Files (every `revalidatePath('/projects/${projectId}', 'layout')` call):**
- `src/features/tasks/actions.ts:78`, `bulk-actions.ts:54`, `labels.ts:51`, `saved-views/actions.ts:45`, `projects/actions.ts:79`, `time/actions.ts:63,77,129,145`, `notifications/actions.ts:119,168,191,245`

**Interfaces:** none new.

- [ ] **Step 1: Replace with the dynamic pattern**

The rendered route is now `/projects/[projectKey]`, so a cuid path no longer matches. Replace each `revalidatePath(\`/projects/${projectId}\`, "layout")` with:

```ts
revalidatePath("/projects/[projectKey]", "layout")
```

This revalidates all project pages (acceptable for an internal app; avoids threading the key to every call site). Where a mutation changes a single task's detail, ALSO add:

```ts
revalidatePath("/browse/[taskKey]", "page")
```

in the task-mutating actions (`tasks/actions.ts`, `time/actions.ts`, `notifications/actions.ts`, `comments`/`attachments` create/delete) so the full page reflects edits.

- [ ] **Step 2: Build**

Run: `npx tsc --noEmit && npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: revalidate key-based project/browse routes by dynamic pattern"
```

---

### Task 8: Integration tests — redirects, permission gating, key resolution

**Files:**
- Create: `src/features/tasks/route-keys.test.ts`

**Interfaces:**
- Consumes: `isCuid`, `resolveProjectIdByKey`, `resolveTaskIdByKey`.

- [ ] **Step 1: Write resolver + discriminator tests**

The pure `isCuid` is covered in Task 1. Add DB-backed resolver tests only if the repo already has a DB test harness (check `queries.test.ts` for the pattern). If `queries.test.ts` mocks Prisma, mirror that. Otherwise, assert the discriminator drives the right branch with a mocked `prisma.task.findUnique`:

```ts
import { describe, it, expect, vi } from "vitest"

// Follow the existing mock style in src/features/tasks/queries.test.ts.
// Assert resolveTaskIdByKey uppercases the key and returns the row id / null.
```

Match the exact mocking approach already used in `src/features/tasks/queries.test.ts` (read it first). Keep this test aligned with that harness rather than inventing a new one.

- [ ] **Step 2: Run**

Run: `npm run test -- src/features/tasks/route-keys.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/route-keys.test.ts
git commit -m "test: key resolution + cuid discriminator"
```

---

### Task 9: Full verification + deploy

- [ ] **Step 1: Full check**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 2: Manual smoke (dev)**

`npm run dev`, verify:
- `/browse/EISC-9` renders; subtask shows parent backlink; expand button on the drawer navigates here.
- `/projects/EISC` renders; old `/projects/<cuid>` redirects.
- Drawer opens with `?task=EISC-9`; old `?task=<cuid>` redirects.
- Copy-link copies a `/browse/...` URL; a due-reminder/mention email link points at `/browse/...`.
- Board quick-add + inline edits still work (project id correctly threaded).

- [ ] **Step 3: Deploy**

Run: `bash deploy.sh`
Expected: `... -> 200`, `=== deployed ===`. Then verify on `https://flux.foodverse.io` that EISC-9's full page and expand button work live.

---

## Self-Review

- **Spec coverage:** §1 routes → Tasks 3–5; §2 redirects → Tasks 3–5 (cuid branches); §3 helpers + call-site sweep → Tasks 1, 6; revalidate → Task 7; §4 full page → Task 3; §5 expand → Task 3; §6 no migration → confirmed (Task 2 uses existing unique keys); §7 testing → Tasks 1, 8; §8 rollout → Task 9. All covered.
- **Placeholder scan:** The only "copy from TaskDetailPanel" directives (Task 3) are deliberate DRY instructions with the exact source file + line ranges named, not vague TODOs; the novel/tricky code (helpers, resolvers, loaders, redirects, expand button) is given in full.
- **Type consistency:** `taskShareUrl` signature change (Task 1) is propagated to `CopyTaskLink` (Task 6). `BoardView` gains `projectId` prop (Task 4). Resolver names `resolveProjectIdByKey`/`resolveTaskIdByKey` used consistently across Tasks 2–5, 8. `taskDrawerPath`/`taskPagePath`/`projectPath` names consistent throughout.

# Executive Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `EXECUTIVE` global role and an org-wide `/executive` overview page so a CEO can see the health of every project without being made a global Admin.

**Architecture:** `EXECUTIVE` is a third value on the existing `GlobalRole` enum. Every authorisation check in the codebase is written `globalRole === "ADMIN"`, so the new value is fail-closed by construction — it grants no admin powers and no mutation rights beyond the user's own `ProjectMembership` rows. One new helper, `requireExecutive()`, is the single place the new read capability is granted. The `/executive` page is a Server Component reading from a new `src/features/executive/queries.ts` that aggregates org-wide with `groupBy`/`count` only.

**Tech Stack:** Next.js 16 (App Router, Server Components, Server Actions), React 19.2, TypeScript strict, Prisma 7 (`prisma-client` generator → `src/generated/prisma`), PostgreSQL 16, Auth.js v5, Tailwind + shadcn/ui, recharts, GSAP (`useGSAP`), Vitest + React Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-07-27-executive-overview-design.md`](../specs/2026-07-27-executive-overview-design.md)

## Global Constraints

- **Migrations, not auto-sync.** Every schema change goes through `npx prisma migrate dev`. Never `db push`.
- **Validate at the boundary.** Every Server Action validates input with a Zod schema before touching the DB.
- **Authorise on the server, always.** Nav visibility and `proxy.ts` are conveniences; the page and every query re-check.
- **No `any` types.** TypeScript strict mode is on.
- **Named exports**, except page components (default export required by Next).
- **Tailwind only** — no custom CSS files. Never hardcode a hex value; reference the token (`--primary`, `--success`, `--warning`, `--danger`, `--info`, `--muted-foreground`, `--surface-raised`, `--border`).
- **Functional colours for data.** Orange (`--primary`) is reserved for accents and CTAs, never for status fills.
- **Animate only `transform` and `opacity`.** Respect `prefers-reduced-motion`. Exactly one entrance animation on the page, after paint, never gating interactivity.
- **Aggregate in the DB.** Use `groupBy` / `count` / narrow `select`. No query may load full task rows except the capped attention list.
- **Pure helpers shared by Server and Client Components must live in a non-`"use client"` module.** (A `"use client"` re-export previously 500'd `/explore`.)
- Run `npm run lint` and `npm run test` before each commit.

---

### Task 1: Add the `EXECUTIVE` global role

Adds the enum value, widens the Zod schema that gates every admin write, adds its display metadata, and fixes the last-admin lockout guard that the new value would otherwise defeat.

**Files:**
- Modify: `prisma/schema.prisma:20-23` (the `GlobalRole` enum)
- Create: `prisma/migrations/<timestamp>_add_executive_global_role/migration.sql` (generated)
- Modify: `src/features/admin/schemas.ts:11`
- Modify: `src/features/admin/components/display.tsx` (`GLOBAL_ROLE_META`, `GLOBAL_ROLE_OPTIONS`, `GLOBAL_ROLE_LABELS`)
- Modify: `src/features/admin/actions.ts:523` (lockout guard)
- Test: `src/features/admin/actions.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `"EXECUTIVE"` member of `GlobalRole` (from `@/generated/prisma/enums`), usable by every later task. `globalRoleSchema` accepts `"ADMIN" | "EXECUTIVE" | "USER"`.

- [ ] **Step 1: Write the failing test**

`src/features/admin/actions.test.ts` has **no** `changeGlobalRole` block yet — add `changeGlobalRole` to the existing `from "./actions"` import list and append a new describe block at the end of the file.

The file's mocks are already set up for this: `db` is the hand-rolled `@/lib/db` mock (`db.user.findUnique`, `db.user.count`, `db.$transaction`), `mockRequireAdmin` is pre-resolved to `ACTOR` in the shared `beforeEach`, and `db.$transaction` is wired to invoke its callback with `db` itself. Use those names — do not introduce new ones.

```ts
describe("changeGlobalRole", () => {
  it("refuses to demote the last active admin to EXECUTIVE", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "target-1",
      globalRole: "ADMIN",
      status: "ACTIVE",
    });
    db.user.count.mockResolvedValue(1);

    const result = await changeGlobalRole({ userId: "target-1", role: "EXECUTIVE" });

    expect(result).toEqual({
      ok: false,
      error: "You can't demote the last active admin.",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("allows demoting an admin to EXECUTIVE when another active admin remains", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "target-1",
      globalRole: "ADMIN",
      status: "ACTIVE",
    });
    db.user.count.mockResolvedValue(2);
    db.user.update.mockResolvedValue({});

    const result = await changeGlobalRole({ userId: "target-1", role: "EXECUTIVE" });

    expect(result).toEqual({ ok: true });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { globalRole: "EXECUTIVE" },
    });
  });

  it("promotes a plain user to EXECUTIVE and audits the change", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "target-2",
      globalRole: "USER",
      status: "ACTIVE",
    });
    db.user.update.mockResolvedValue({});

    const result = await changeGlobalRole({ userId: "target-2", role: "EXECUTIVE" });

    expect(result).toEqual({ ok: true });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "user.role_changed",
          metadata: { from: "USER", to: "EXECUTIVE" },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/admin/actions.test.ts -t "EXECUTIVE"`
Expected: FAIL — the Zod `globalRoleSchema` rejects `"EXECUTIVE"`, so `changeGlobalRole` returns `{ ok: false, error: "Invalid input." }` rather than the lockout error.

- [ ] **Step 3: Add the enum value to the Prisma schema**

In `prisma/schema.prisma`, replace the `GlobalRole` enum:

```prisma
enum GlobalRole {
  ADMIN
  EXECUTIVE
  USER
}
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `npx prisma migrate dev --name add_executive_global_role`

Then **open the generated `migration.sql` and check it**. It should contain exactly one meaningful statement:

```sql
-- AlterEnum
ALTER TYPE "GlobalRole" ADD VALUE 'EXECUTIVE';
```

**Two things to verify before committing:**

1. **Delete any `DROP INDEX "TimeEntry_one_running_per_user";`** if Prisma emitted one. That partial unique index (`ON "TimeEntry"("userId") WHERE "endedAt" IS NULL`) is hand-authored in `prisma/migrations/20260719121045_time_entry/migration.sql` and cannot be expressed in the Prisma schema, so `migrate dev` tries to drop it on every subsequent migration. Dropping it would let a user start two concurrent timers.
2. PostgreSQL appends the new enum value at the **end** of the type's sort order regardless of where it sits in the schema file. Nothing in the codebase sorts by `globalRole`, so this is fine — do not add a `BEFORE`/`AFTER` clause to "fix" it.

- [ ] **Step 5: Widen the Zod schema**

In `src/features/admin/schemas.ts`, line 11:

```ts
export const globalRoleSchema = z.enum(["ADMIN", "EXECUTIVE", "USER"]);
```

This single edit propagates to `changeGlobalRoleSchema`, `createUserSchema`, and `sendInviteSchema` — all of which reuse it — so a user can also be *invited* directly as an executive.

- [ ] **Step 6: Fix the lockout guard**

In `src/features/admin/actions.ts`, inside `changeGlobalRole`, replace the demotion guard:

```ts
    // Demotion guard: never strip the final ACTIVE admin of ADMIN — for ANY
    // target role, not just USER. With EXECUTIVE in the enum, a `role === "USER"`
    // check would let `ADMIN → EXECUTIVE` lock the org out of /admin permanently.
    if (target.globalRole === "ADMIN" && role !== "ADMIN") {
      const activeAdmins = await prisma.user.count({
        where: { globalRole: "ADMIN", status: "ACTIVE" },
      });
      if (target.status === "ACTIVE" && activeAdmins <= 1) {
        return { ok: false, error: "You can't demote the last active admin." };
      }
    }
```

- [ ] **Step 7: Add the display metadata**

In `src/features/admin/components/display.tsx`, add the `EXECUTIVE` entry to all three exported maps. `GLOBAL_ROLE_META` and `GLOBAL_ROLE_LABELS` are `Record<GlobalRole, …>`, so TypeScript fails to compile until all three are updated — that is the intended safety net.

```ts
export const GLOBAL_ROLE_META: Record<GlobalRole, ChipMeta> = {
  ADMIN: {
    label: "Admin",
    chipClass: "bg-primary/10 text-primary",
    dotClass: "bg-primary",
  },
  EXECUTIVE: {
    label: "Executive",
    chipClass: "bg-info/10 text-info",
    dotClass: "bg-info",
  },
  USER: {
    label: "User",
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
};
```

```ts
export const GLOBAL_ROLE_OPTIONS = [
  { value: "USER", label: "User" },
  { value: "EXECUTIVE", label: "Executive" },
  { value: "ADMIN", label: "Admin" },
] as const satisfies ReadonlyArray<{ value: GlobalRole; label: string }>;
```

```ts
export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  ADMIN: "Admin",
  EXECUTIVE: "Executive",
  USER: "User",
};
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/features/admin/actions.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, no type errors, no lint errors.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/features/admin/schemas.ts src/features/admin/components/display.tsx src/features/admin/actions.ts src/features/admin/actions.test.ts
git commit -m "feat(admin): add EXECUTIVE global role

Third value on GlobalRole, assignable from the admin area and via invite.
Grants no admin powers: every authorisation check is `globalRole === \"ADMIN\"`,
so EXECUTIVE falls through as a non-admin.

Broadens the last-admin lockout guard from \`role === \"USER\"\` to
\`role !== \"ADMIN\"\` — otherwise demoting the last admin to EXECUTIVE would
lock the organisation out of /admin permanently."
```

---

### Task 2: `requireExecutive()` authorisation helper

The single place the new read capability is granted.

**Files:**
- Modify: `src/lib/permissions.ts` (append after `requireAdmin`)
- Test: `src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: the `EXECUTIVE` enum value from Task 1.
- Produces: `requireExecutive(): Promise<User>` — resolves the ACTIVE session user when `globalRole` is `EXECUTIVE` or `ADMIN`; throws `AuthorizationError("FORBIDDEN")` for `USER`, `AuthorizationError("UNAUTHENTICATED")` with no session, `AuthorizationError("SUSPENDED")` when not ACTIVE. Every later query and the `/executive` page call it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/permissions.test.ts`. The file already mocks `@/lib/auth` and `@/lib/db` and exposes `mockAuth`, `mockFindUser`, and a `makeUser(overrides)` factory — reuse them, and add `requireExecutive` to the existing import list from `./permissions`.

```ts
describe("requireExecutive", () => {
  it("resolves an ACTIVE executive", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "EXECUTIVE" }));

    const user = await requireExecutive();

    expect(user.globalRole).toBe("EXECUTIVE");
  });

  it("resolves an ACTIVE admin (admins can preview the executive view)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "ADMIN" }));

    const user = await requireExecutive();

    expect(user.globalRole).toBe("ADMIN");
  });

  it("rejects a plain USER with FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));

    await expect(requireExecutive()).rejects.toMatchObject({
      name: "AuthorizationError",
      code: "FORBIDDEN",
    });
  });

  it("rejects a SUSPENDED executive with SUSPENDED", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(
      makeUser({ globalRole: "EXECUTIVE", status: "SUSPENDED" }),
    );

    await expect(requireExecutive()).rejects.toMatchObject({
      name: "AuthorizationError",
      code: "SUSPENDED",
    });
  });

  it("rejects an anonymous caller with UNAUTHENTICATED", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireExecutive()).rejects.toMatchObject({
      name: "AuthorizationError",
      code: "UNAUTHENTICATED",
    });
  });
});

describe("EXECUTIVE has no elevated write access", () => {
  it("is refused by requireAdmin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "EXECUTIVE" }));

    await expect(requireAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is refused by requireProjectRole without a membership", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "EXECUTIVE" }));
    mockFindMembership.mockResolvedValue(null);

    await expect(requireProjectRole("project-1", "VIEWER")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("gets exactly its membership role, with no admin bypass", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "EXECUTIVE" }));
    mockFindMembership.mockResolvedValue({ projectRole: "VIEWER" });

    const { role } = await requireProjectRole("project-1", "VIEWER");

    expect(role).toBe("VIEWER");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/permissions.test.ts -t "Executive"`
Expected: FAIL — `requireExecutive` is not exported from `./permissions`.

- [ ] **Step 3: Implement the helper**

In `src/lib/permissions.ts`, immediately after `requireAdmin`:

```ts
/**
 * Require an ACTIVE global Admin OR Executive.
 *
 * EXECUTIVE is a READ-ONLY, ORG-WIDE VISIBILITY role and this is the ONLY place
 * that capability is granted. It deliberately does not appear in requireAdmin,
 * requireProjectRole, canManageTeam, or any other helper: every one of those
 * tests `globalRole === "ADMIN"`, so an Executive falls through them as a plain
 * user and keeps exactly the write access their ProjectMembership rows give
 * them — no more.
 *
 * Admins pass too, so the executive view stays previewable and testable by the
 * people who administer it.
 */
export async function requireExecutive(): Promise<User> {
  const user = await requireUser();
  if (user.globalRole !== "EXECUTIVE" && user.globalRole !== "ADMIN") {
    throw new AuthorizationError("FORBIDDEN");
  }
  return user;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/permissions.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat(permissions): requireExecutive — org-wide read capability

The single place EXECUTIVE grants anything. Every other helper still tests
globalRole === ADMIN, so an Executive keeps exactly their ProjectMembership
write access. Tests assert requireAdmin and requireProjectRole both refuse
an Executive without a membership."
```

---

### Task 3: Route guard, nav link, and the `/executive` shell

Delivers a reachable-but-empty page with correct access control, testable end to end before any data work.

**Files:**
- Modify: `src/proxy.ts`
- Modify: `src/components/shell/NavLinks.tsx`
- Modify: `src/components/shell/Sidebar.tsx`
- Modify: `src/components/shell/Topbar.tsx`
- Modify: `src/components/shell/MobileNav.tsx`
- Create: `src/app/(dashboard)/executive/page.tsx`

**Interfaces:**
- Consumes: `requireExecutive()` from Task 2.
- Produces: the route `/executive` (default-exported async `ExecutivePage`), and a `showExecutive?: boolean` prop on `NavLinks`, `MobileNav`. Task 9 replaces the page body.

- [ ] **Step 1: Add the proxy guard**

In `src/proxy.ts`, directly after the existing `/admin` branch inside `proxy()`:

```ts
  // Executive overview: EXECUTIVE or ADMIN only. Same treatment as /admin —
  // authenticated but unauthorised users go to their dashboard, not to login.
  // Cheap JWT check; the page re-checks via requireExecutive().
  if (pathname === "/executive" || pathname.startsWith("/executive/")) {
    if (token.globalRole !== "EXECUTIVE" && token.globalRole !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }
```

`token.globalRole` is already populated — `src/lib/auth.ts:61` writes it into the JWT.

- [ ] **Step 2: Add the nav item**

In `src/components/shell/NavLinks.tsx`: add `Building2` to the `lucide-react` import, define the item next to the other conditional items, add the prop, and include it in `items`.

```ts
const EXECUTIVE_NAV_ITEM: NavItem = { href: "/executive", label: "Overview", icon: Building2, tourId: "nav-executive" };
```

```ts
export function NavLinks({
  isAdmin = false,
  showExecutive = false,
  showManager = false,
  showTeam = false,
  unreadCount = 0,
}: {
  isAdmin?: boolean;
  showExecutive?: boolean;
  showManager?: boolean;
  showTeam?: boolean;
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const items = [
    ...(showExecutive ? [EXECUTIVE_NAV_ITEM] : []),
    ...BASE_NAV_ITEMS,
    ...(showManager ? [MANAGER_NAV_ITEM] : []),
    ...(showTeam ? [TEAM_NAV_ITEM] : []),
    ...(isAdmin ? [ADMIN_NAV_ITEM] : []),
  ];
```

Overview goes **first** — for an executive it is the primary destination. Also extend the component's doc comment to note that `/executive` is server-guarded regardless, matching how the existing conditional links are documented.

- [ ] **Step 3: Thread the flag through the three shell components**

In `src/components/shell/Sidebar.tsx`, after the existing `isAdmin` line:

```ts
  const isAdmin = session?.user?.globalRole === "ADMIN";
  // /executive is server-guarded regardless (proxy + requireExecutive) — this
  // only hides the link from users who couldn't use it anyway.
  const showExecutive = isAdmin || session?.user?.globalRole === "EXECUTIVE";
```

and pass `showExecutive={showExecutive}` to `<NavLinks />`.

In `src/components/shell/Topbar.tsx`, add the identical `showExecutive` line after its `isAdmin` line and pass `showExecutive={showExecutive}` to `<MobileNav />`.

In `src/components/shell/MobileNav.tsx`, add `showExecutive = false` to the destructured props and `showExecutive?: boolean` to the prop type, then forward it to the nested `<NavLinks />`.

- [ ] **Step 4: Create the page shell**

Create `src/app/(dashboard)/executive/page.tsx`:

```tsx
import { requireExecutive } from "@/lib/permissions";

/**
 * Executive Overview — org-wide project health for the EXECUTIVE role.
 *
 * SCOPING (deliberate, documented): unlike /dashboard (personal) and /manager
 * (team-scoped), every figure here spans EVERY project regardless of the
 * viewer's memberships. Drill-down is still membership-gated — see Task 9's
 * project cards.
 */
export default async function ExecutivePage() {
  await requireExecutive();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">
        Overview
      </h1>
    </div>
  );
}
```

- [ ] **Step 5: Verify manually**

Run: `npm run dev`, then in `npx prisma studio` set your own user's `globalRole` to `EXECUTIVE`.
Expected: "Overview" is the first sidebar item and `/executive` renders the heading. Set the role back to `USER` and reload — the link disappears and `/executive` redirects to `/dashboard`. Restore the role you started with.

- [ ] **Step 6: Commit**

```bash
git add src/proxy.ts src/components/shell src/app/\(dashboard\)/executive
git commit -m "feat(executive): route guard, nav link, and page shell

/executive gated in proxy.ts on the JWT and re-checked in the page via
requireExecutive(). Overview leads the nav for executives and admins."
```

---

### Task 4: Role-aware post-login landing

**Files:**
- Create: `src/lib/landing.ts`
- Create: `src/lib/landing.test.ts`
- Modify: `src/app/page.tsx:29`
- Modify: `src/features/auth/components/LoginForm.tsx:49`

**Interfaces:**
- Consumes: the `EXECUTIVE` enum value from Task 1.
- Produces: `defaultLandingPath(globalRole: GlobalRole | undefined): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/landing.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { defaultLandingPath } from "./landing";

describe("defaultLandingPath", () => {
  it("sends an executive to the overview", () => {
    expect(defaultLandingPath("EXECUTIVE")).toBe("/executive");
  });

  it("sends an admin to the personal dashboard", () => {
    expect(defaultLandingPath("ADMIN")).toBe("/dashboard");
  });

  it("sends a regular user to the personal dashboard", () => {
    expect(defaultLandingPath("USER")).toBe("/dashboard");
  });

  it("falls back to the dashboard for an unknown role", () => {
    expect(defaultLandingPath(undefined)).toBe("/dashboard");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/landing.test.ts`
Expected: FAIL — cannot resolve `./landing`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/landing.ts`:

```ts
// Where a signed-in user lands when no explicit callbackUrl was supplied.
//
// NOT a "use client" module: it is imported by a Server Component
// (app/page.tsx) AND by the client login form. A pure helper re-exported from
// a "use client" file 500s its server callers — keep this module neutral.

import type { GlobalRole } from "@/generated/prisma/enums";

/**
 * An EXECUTIVE's home is the org-wide overview; everyone else starts on their
 * personal dashboard. This only sets a DEFAULT — /dashboard stays reachable
 * from the nav for executives, and an explicit callbackUrl always wins.
 */
export function defaultLandingPath(globalRole: GlobalRole | undefined): string {
  return globalRole === "EXECUTIVE" ? "/executive" : "/dashboard";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/landing.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the landing page**

In `src/app/page.tsx`, add the import and replace the signed-in redirect:

```ts
import { defaultLandingPath } from "@/lib/landing";
```

```ts
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect(defaultLandingPath(session.user.globalRole));
```

- [ ] **Step 6: Point the login form's default at `/`**

In `src/features/auth/components/LoginForm.tsx`, line 49:

```ts
  // "/" resolves the role-aware default server-side (see lib/landing.ts) — the
  // landing page redirects signed-in users before rendering, so there is no
  // flash of marketing content. An explicit, safe callbackUrl still wins.
  const redirectTarget = isSafeRelativePath(callbackUrl) ? callbackUrl : "/";
```

- [ ] **Step 7: Verify manually**

Run: `npm run dev`. Sign in as an `EXECUTIVE`.
Expected: you land on `/executive`. Sign in as a `USER`: you land on `/dashboard`. Visit `/login?callbackUrl=/projects` and sign in: you land on `/projects` in both cases.

- [ ] **Step 8: Commit**

```bash
git add src/lib/landing.ts src/lib/landing.test.ts src/app/page.tsx src/features/auth/components/LoginForm.tsx
git commit -m "feat(auth): role-aware post-login landing

Executives land on /executive, everyone else on /dashboard. The helper lives in
a non-client module because both a Server Component and the client login form
import it."
```

---

### Task 5: Executive scope, org KPIs, and throughput

**Files:**
- Create: `src/features/executive/queries.ts`
- Create: `src/features/executive/weeks.ts`
- Create: `src/features/executive/weeks.test.ts`

**Interfaces:**
- Consumes: `requireExecutive()` from Task 2.
- Produces:
  - `interface ExecutiveScope { userId: string; memberProjectIds: Set<string> }`
  - `getExecutiveScope(): Promise<ExecutiveScope>`
  - `interface ExecutiveKpis { open: number; completedThisWeek: number; completedLastWeek: number; overdue: number; overdueLastWeek: number; inReview: number; openLastWeek: number }`
  - `getExecutiveKpis(scope?: ExecutiveScope): Promise<ExecutiveKpis>`
  - `interface OrgThroughputWeek { label: string; created: number; completed: number }`
  - `getOrgThroughput(scope?: ExecutiveScope): Promise<OrgThroughputWeek[]>`
  - from `weeks.ts`: `startOfIsoWeek(d: Date): Date`, `weekLabel(d: Date): string`, `WEEK_MS: number`, `DAY_MS: number`

- [ ] **Step 1: Write the failing test for the week helpers**

Create `src/features/executive/weeks.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { WEEK_MS, startOfIsoWeek, weekLabel } from "./weeks";

describe("startOfIsoWeek", () => {
  it("returns Monday midnight for a mid-week date", () => {
    // Wednesday 2026-07-22, 14:30 local
    const result = startOfIsoWeek(new Date(2026, 6, 22, 14, 30));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(20); // Monday
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it("treats Monday itself as the start of its own week", () => {
    const result = startOfIsoWeek(new Date(2026, 6, 20, 9, 0));
    expect(result.getDate()).toBe(20);
    expect(result.getHours()).toBe(0);
  });

  it("treats Sunday as the END of the week that began the previous Monday", () => {
    const result = startOfIsoWeek(new Date(2026, 6, 26, 23, 59));
    expect(result.getDate()).toBe(20);
  });

  it("does not mutate its argument", () => {
    const input = new Date(2026, 6, 22, 14, 30);
    startOfIsoWeek(input);
    expect(input.getDate()).toBe(22);
    expect(input.getHours()).toBe(14);
  });
});

describe("weekLabel", () => {
  it("formats a week-start as day + short month", () => {
    expect(weekLabel(new Date(2026, 6, 20))).toBe("20 Jul");
  });
});

describe("WEEK_MS", () => {
  it("is seven days of milliseconds", () => {
    expect(WEEK_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("splitCompletionsByWeek", () => {
  const thisWeekStart = new Date(2026, 6, 20); // Monday 2026-07-20, 00:00

  it("assigns a completion at exactly the week boundary to THIS week", () => {
    const { thisWeek, lastWeek } = splitCompletionsByWeek(
      [{ taskId: "t1", createdAt: new Date(2026, 6, 20, 0, 0, 0, 0) }],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(1);
    expect(lastWeek.size).toBe(0);
  });

  it("assigns a completion one millisecond before the boundary to LAST week", () => {
    const { thisWeek, lastWeek } = splitCompletionsByWeek(
      [{ taskId: "t1", createdAt: new Date(2026, 6, 19, 23, 59, 59, 999) }],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(0);
    expect(lastWeek.size).toBe(1);
  });

  it("counts a task bounced through Done twice in one week only once", () => {
    const { thisWeek } = splitCompletionsByWeek(
      [
        { taskId: "t1", createdAt: new Date(2026, 6, 21, 9, 0) },
        { taskId: "t1", createdAt: new Date(2026, 6, 23, 15, 0) },
      ],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(1);
  });

  it("counts the same task in BOTH weeks when completed in each", () => {
    const { thisWeek, lastWeek } = splitCompletionsByWeek(
      [
        { taskId: "t1", createdAt: new Date(2026, 6, 15, 9, 0) },
        { taskId: "t1", createdAt: new Date(2026, 6, 21, 9, 0) },
      ],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(1);
    expect(lastWeek.size).toBe(1);
  });
});
```

Add `splitCompletionsByWeek` to the import at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/executive/weeks.test.ts`
Expected: FAIL — cannot resolve `./weeks`.

- [ ] **Step 3: Implement the week helpers**

Create `src/features/executive/weeks.ts`. These are lifted verbatim from `features/dashboard/queries.ts:63-89` so the two dashboards bucket weeks identically; they live in their own module because the executive charts need them and importing a server-only query module for a pure helper would drag Prisma into the bundle.

```ts
// Week bucketing shared by the executive queries and their charts. Pure, no
// I/O, no "use client" — safe to import from either side.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** Midnight Monday of the ISO week containing `d` (server-local time). */
export function startOfIsoWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // Mon = 0
  return date;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "23 Jun" — deterministic label for a week-start date. */
export function weekLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Split completion rows into this-week / last-week task-id SETS.
 *
 * Extracted as a pure function so the week-boundary arithmetic is unit-testable
 * without a database: `createdAt >= thisWeekStart` puts a completion landing at
 * exactly midnight Monday into THIS week, and de-duping by taskId means a task
 * bounced through Done twice in one week counts once.
 */
export function splitCompletionsByWeek(
  rows: readonly { taskId: string; createdAt: Date }[],
  thisWeekStart: Date,
): { thisWeek: Set<string>; lastWeek: Set<string> } {
  const thisWeek = new Set<string>();
  const lastWeek = new Set<string>();
  for (const row of rows) {
    (row.createdAt >= thisWeekStart ? thisWeek : lastWeek).add(row.taskId);
  }
  return { thisWeek, lastWeek };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/executive/weeks.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the scope, KPI, and throughput queries**

Create `src/features/executive/queries.ts`:

```ts
// Executive Overview read queries. Server-only (DB + session), consumed by the
// /executive Server Component — permission failures THROW to the nearest error
// boundary, matching features/dashboard|manager/queries.ts.
//
// SCOPING (deliberate, documented): unlike the PERSONAL dashboard, every figure
// here is ORG-WIDE — all projects, all people, regardless of the viewer's
// memberships. That is the whole point of the view. `scope.memberProjectIds`
// exists ONLY so the UI can decide which project cards are clickable; it never
// filters an aggregate.
//
// EFFICIENCY: aggregates come from groupBy/count or narrow selects. The ONLY
// row-level read is the attention list, which is capped. The page resolves the
// scope ONCE and passes it to each query so Promise.all() doesn't re-authorise
// six times; each query still resolves its own scope when called standalone.

import { prisma } from "@/lib/db";
import { requireExecutive } from "@/lib/permissions";
import {
  WEEK_MS,
  splitCompletionsByWeek,
  startOfIsoWeek,
  weekLabel,
} from "./weeks";

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveScope {
  userId: string;
  /**
   * Projects this viewer may actually OPEN — their ProjectMembership rows, or
   * every project when they are a global Admin (admin-bypass policy). Used for
   * link/lock rendering only, never to filter an aggregate.
   */
  memberProjectIds: Set<string>;
}

export async function getExecutiveScope(): Promise<ExecutiveScope> {
  const user = await requireExecutive();

  if (user.globalRole === "ADMIN") {
    const projects = await prisma.project.findMany({ select: { id: true } });
    return { userId: user.id, memberProjectIds: new Set(projects.map((p) => p.id)) };
  }

  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return {
    userId: user.id,
    memberProjectIds: new Set(memberships.map((m) => m.projectId)),
  };
}

// A "completion" is an ActivityLog row with field="status", newValue="DONE" —
// written by every path that lands a task in Done. Chosen over
// `updatedAt + status=DONE` because updatedAt moves on ANY edit, which would
// silently re-date old completions. Identical to the dashboard's definition so
// the two views never disagree about what "completed" means.
const COMPLETION_LOG = { field: "status", newValue: "DONE" } as const;

const OPEN_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Org KPIs
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveKpis {
  open: number;
  openLastWeek: number;
  completedThisWeek: number;
  completedLastWeek: number;
  overdue: number;
  overdueLastWeek: number;
  inReview: number;
}

/**
 * The four headline numbers plus their prior-week baselines.
 *
 * "openLastWeek" and "overdueLastWeek" are point-in-time reconstructions: tasks
 * that already existed at the start of this week and are still open / already
 * overdue. They are deliberately approximations — Flux does not snapshot task
 * state — and are used only to render a direction-of-travel delta chip.
 */
export async function getExecutiveKpis(
  scope?: ExecutiveScope,
): Promise<ExecutiveKpis> {
  if (!scope) await requireExecutive();

  const now = new Date();
  const thisWeekStart = startOfIsoWeek(now);
  const lastWeekStart = new Date(thisWeekStart.getTime() - WEEK_MS);

  const [byStatus, openAtWeekStart, overdue, overdueAtWeekStart, completions] =
    await Promise.all([
      prisma.task.groupBy({
        by: ["status"],
        where: { status: { in: [...OPEN_STATUSES] } },
        _count: { _all: true },
      }),
      prisma.task.count({
        where: {
          status: { in: [...OPEN_STATUSES] },
          createdAt: { lt: thisWeekStart },
        },
      }),
      prisma.task.count({
        where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } },
      }),
      prisma.task.count({
        where: {
          status: { in: [...OPEN_STATUSES] },
          dueDate: { lt: thisWeekStart },
        },
      }),
      prisma.activityLog.findMany({
        where: { ...COMPLETION_LOG, createdAt: { gte: lastWeekStart } },
        select: { taskId: true, createdAt: true },
      }),
    ]);

  const countFor = (status: string): number =>
    byStatus.find((g) => g.status === status)?._count._all ?? 0;

  // De-dupe per (week, task) — see splitCompletionsByWeek in ./weeks.
  const { thisWeek, lastWeek } = splitCompletionsByWeek(completions, thisWeekStart);

  return {
    open: OPEN_STATUSES.reduce((sum, s) => sum + countFor(s), 0),
    openLastWeek: openAtWeekStart,
    completedThisWeek: thisWeek.size,
    completedLastWeek: lastWeek.size,
    overdue,
    overdueLastWeek: overdueAtWeekStart,
    inReview: countFor("IN_REVIEW"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Org throughput — created vs completed, 8 weeks
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgThroughputWeek {
  label: string;
  created: number;
  completed: number;
}

/** Two narrow reads over an 8-week window, bucketed in memory. */
export async function getOrgThroughput(
  scope?: ExecutiveScope,
): Promise<OrgThroughputWeek[]> {
  if (!scope) await requireExecutive();

  const WEEKS = 8;
  const thisWeekStart = startOfIsoWeek(new Date());
  const windowStart = new Date(thisWeekStart.getTime() - (WEEKS - 1) * WEEK_MS);

  const [completionRows, createdRows] = await Promise.all([
    prisma.activityLog.findMany({
      where: { ...COMPLETION_LOG, createdAt: { gte: windowStart } },
      select: { taskId: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { id: true, createdAt: true },
    }),
  ]);

  const bucketIndex = (d: Date): number =>
    Math.floor(
      (startOfIsoWeek(d).getTime() - windowStart.getTime()) / WEEK_MS,
    );

  const completed = Array.from({ length: WEEKS }, () => new Set<string>());
  for (const row of completionRows) {
    const i = bucketIndex(row.createdAt);
    if (i >= 0 && i < WEEKS) completed[i]!.add(row.taskId);
  }

  const created = Array.from({ length: WEEKS }, () => 0);
  for (const row of createdRows) {
    const i = bucketIndex(row.createdAt);
    if (i >= 0 && i < WEEKS) created[i]! += 1;
  }

  return Array.from({ length: WEEKS }, (_, i) => ({
    label: weekLabel(new Date(windowStart.getTime() + i * WEEK_MS)),
    created: created[i]!,
    completed: completed[i]!.size,
  }));
}
```

- [ ] **Step 6: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/executive
git commit -m "feat(executive): scope, org KPIs, and 8-week throughput queries

Org-wide aggregates via groupBy/count. memberProjectIds is carried for
link/lock rendering only and never filters a figure. Week bucketing is lifted
into a pure weeks.ts so charts can import it without pulling in Prisma."
```

---

### Task 6: Project health signal

**Files:**
- Create: `src/features/executive/health.ts`
- Create: `src/features/executive/health.test.ts`
- Modify: `src/features/executive/queries.ts` (append `getProjectHealth`)

**Interfaces:**
- Consumes: `ExecutiveScope`, `startOfIsoWeek`, `WEEK_MS`, `DAY_MS` from Task 5.
- Produces:
  - `type ProjectHealth = "ON_TRACK" | "AT_RISK" | "STALLED"`
  - `interface HealthInputs { open: number; overdue: number; unassignedUrgent: number; activity14d: number }`
  - `projectHealth(inputs: HealthInputs): ProjectHealth`
  - `interface ExecutiveProject { id: string; key: string; name: string; leadName: string; done: number; total: number; open: number; inReview: number; overdue: number; unassignedUrgent: number; activity7d: number; activity14d: number; spark: number[]; health: ProjectHealth; canOpen: boolean }`
  - `getProjectHealth(scope?: ExecutiveScope): Promise<ExecutiveProject[]>`

- [ ] **Step 1: Write the failing test**

Create `src/features/executive/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { projectHealth, type HealthInputs } from "./health";

const healthy: HealthInputs = {
  open: 5,
  overdue: 0,
  unassignedUrgent: 0,
  activity14d: 12,
};

describe("projectHealth", () => {
  it("is ON_TRACK when nothing is late, unowned, or silent", () => {
    expect(projectHealth(healthy)).toBe("ON_TRACK");
  });

  it("is AT_RISK with any overdue task", () => {
    expect(projectHealth({ ...healthy, overdue: 1 })).toBe("AT_RISK");
  });

  it("is AT_RISK with an unassigned urgent task", () => {
    expect(projectHealth({ ...healthy, unassignedUrgent: 1 })).toBe("AT_RISK");
  });

  it("is STALLED when silent for 14 days with open work", () => {
    expect(projectHealth({ ...healthy, activity14d: 0 })).toBe("STALLED");
  });

  it("prefers STALLED over AT_RISK when both apply", () => {
    // Silence is the more actionable signal: nobody is touching it at all.
    expect(
      projectHealth({ ...healthy, activity14d: 0, overdue: 3 }),
    ).toBe("STALLED");
  });

  it("is ON_TRACK when silent but with NO open work (finished, not stalled)", () => {
    expect(projectHealth({ ...healthy, open: 0, activity14d: 0 })).toBe("ON_TRACK");
  });

  it("does NOT flag a week-over-week completion decline", () => {
    // Deliberately rejected as a trigger: it would paint healthy projects amber
    // on a quiet week, and a signal that fires on healthy projects stops being
    // read. Amber means late work or unowned urgent work — nothing else.
    expect(projectHealth(healthy)).toBe("ON_TRACK");
  });

  it("treats exactly zero overdue as not-at-risk (boundary)", () => {
    expect(projectHealth({ ...healthy, overdue: 0 })).toBe("ON_TRACK");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/executive/health.test.ts`
Expected: FAIL — cannot resolve `./health`.

- [ ] **Step 3: Implement the pure health function**

Create `src/features/executive/health.ts`:

```ts
// The project health signal. Pure and dependency-free so it is trivially
// testable and so both the server queries and any client component can use it.

export type ProjectHealth = "ON_TRACK" | "AT_RISK" | "STALLED";

export interface HealthInputs {
  /** Tasks not in DONE. */
  open: number;
  /** Open tasks whose dueDate has passed. */
  overdue: number;
  /** Open URGENT tasks with no assignee. */
  unassignedUrgent: number;
  /** ActivityLog entries on this project's tasks in the last 14 days. */
  activity14d: number;
}

/**
 * Evaluated in order — STALLED wins over AT_RISK because total silence is the
 * more actionable signal.
 *
 *   STALLED   — activity14d === 0 && open > 0
 *   AT_RISK   — overdue > 0 || unassignedUrgent > 0
 *   ON_TRACK  — otherwise
 *
 * A week-over-week completion DECLINE was deliberately rejected as a trigger:
 * on a quiet week it would paint healthy projects amber, and a signal that
 * fires on healthy projects stops being read.
 */
export function projectHealth({
  open,
  overdue,
  unassignedUrgent,
  activity14d,
}: HealthInputs): ProjectHealth {
  if (activity14d === 0 && open > 0) return "STALLED";
  if (overdue > 0 || unassignedUrgent > 0) return "AT_RISK";
  return "ON_TRACK";
}

/** Token-mapped chip metadata — functional colours only, never orange. */
export const HEALTH_META: Record<
  ProjectHealth,
  { label: string; chipClass: string; dotClass: string }
> = {
  ON_TRACK: {
    label: "On track",
    chipClass: "bg-success/10 text-success",
    dotClass: "bg-success",
  },
  AT_RISK: {
    label: "At risk",
    chipClass: "bg-warning/10 text-warning",
    dotClass: "bg-warning",
  },
  STALLED: {
    label: "Stalled",
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/executive/health.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the per-project query**

Append to `src/features/executive/queries.ts` (and add `DAY_MS` plus the health imports to the existing import block at the top):

```ts
import { DAY_MS, WEEK_MS, startOfIsoWeek, weekLabel } from "./weeks";
import { projectHealth, type ProjectHealth } from "./health";
```

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Project health board
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveProject {
  id: string;
  key: string;
  name: string;
  leadName: string;
  done: number;
  total: number;
  open: number;
  inReview: number;
  overdue: number;
  unassignedUrgent: number;
  activity7d: number;
  activity14d: number;
  /** Completions per week over the last 6 weeks — the card sparkline. */
  spark: number[];
  health: ProjectHealth;
  /** False → render the card as a locked, non-navigable tile. */
  canOpen: boolean;
}

const HEALTH_ORDER: Record<ProjectHealth, number> = {
  STALLED: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
};

/**
 * Every project with its card figures, worst health first.
 *
 * Six queries TOTAL regardless of project count — never N per project. Each
 * grouped read is keyed by projectId and zipped in memory.
 */
export async function getProjectHealth(
  scope?: ExecutiveScope,
): Promise<ExecutiveProject[]> {
  const s = scope ?? (await getExecutiveScope());

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since14d = new Date(now.getTime() - 14 * DAY_MS);
  const SPARK_WEEKS = 6;
  const thisWeekStart = startOfIsoWeek(now);
  const sparkStart = new Date(
    thisWeekStart.getTime() - (SPARK_WEEKS - 1) * WEEK_MS,
  );

  const projects = await prisma.project.findMany({
    select: { id: true, key: true, name: true, lead: { select: { name: true } } },
  });
  if (projects.length === 0) return [];

  const [statusCounts, overdueCounts, urgentCounts, activityRows, completionRows] =
    await Promise.all([
      prisma.task.groupBy({
        by: ["projectId", "status"],
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: {
          status: { in: [...OPEN_STATUSES] },
          priority: "URGENT",
          assigneeId: null,
        },
        _count: { _all: true },
      }),
      prisma.activityLog.findMany({
        where: { createdAt: { gte: since14d } },
        select: { createdAt: true, task: { select: { projectId: true } } },
      }),
      prisma.activityLog.findMany({
        where: { ...COMPLETION_LOG, createdAt: { gte: sparkStart } },
        select: {
          taskId: true,
          createdAt: true,
          task: { select: { projectId: true } },
        },
      }),
    ]);

  const statusFor = (projectId: string, status: string): number =>
    statusCounts.find((g) => g.projectId === projectId && g.status === status)
      ?._count._all ?? 0;
  const scalarFor = (
    rows: { projectId: string; _count: { _all: number } }[],
    projectId: string,
  ): number => rows.find((g) => g.projectId === projectId)?._count._all ?? 0;

  const activity7d = new Map<string, number>();
  const activity14d = new Map<string, number>();
  for (const row of activityRows) {
    const id = row.task.projectId;
    activity14d.set(id, (activity14d.get(id) ?? 0) + 1);
    if (row.createdAt >= since7d) {
      activity7d.set(id, (activity7d.get(id) ?? 0) + 1);
    }
  }

  // Per-project, per-week completion sets (de-duped by taskId, as elsewhere).
  const sparks = new Map<string, Set<string>[]>();
  for (const row of completionRows) {
    const id = row.task.projectId;
    const i = Math.floor(
      (startOfIsoWeek(row.createdAt).getTime() - sparkStart.getTime()) / WEEK_MS,
    );
    if (i < 0 || i >= SPARK_WEEKS) continue;
    let weeks = sparks.get(id);
    if (!weeks) {
      weeks = Array.from({ length: SPARK_WEEKS }, () => new Set<string>());
      sparks.set(id, weeks);
    }
    weeks[i]!.add(row.taskId);
  }

  const cards = projects.map((p): ExecutiveProject => {
    const todo = statusFor(p.id, "TODO");
    const inProgress = statusFor(p.id, "IN_PROGRESS");
    const inReview = statusFor(p.id, "IN_REVIEW");
    const done = statusFor(p.id, "DONE");
    const open = todo + inProgress + inReview;
    const overdue = scalarFor(overdueCounts, p.id);
    const unassignedUrgent = scalarFor(urgentCounts, p.id);
    const seen14d = activity14d.get(p.id) ?? 0;

    return {
      id: p.id,
      key: p.key,
      name: p.name,
      leadName: p.lead.name,
      done,
      total: open + done,
      open,
      inReview,
      overdue,
      unassignedUrgent,
      activity7d: activity7d.get(p.id) ?? 0,
      activity14d: seen14d,
      spark: (sparks.get(p.id) ?? []).map((set) => set.size),
      health: projectHealth({
        open,
        overdue,
        unassignedUrgent,
        activity14d: seen14d,
      }),
      canOpen: s.memberProjectIds.has(p.id),
    };
  });

  return cards.sort(
    (a, b) =>
      HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || b.open - a.open,
  );
}
```

Note `spark` is `[]` for a project with no completions in the window — the card component must handle an empty array (Task 9).

- [ ] **Step 6: Verify it compiles and lints**

Run: `npx vitest run src/features/executive && npx tsc --noEmit && npm run lint`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/executive
git commit -m "feat(executive): project health signal and health board query

STALLED > AT_RISK > ON_TRACK, evaluated by a pure, table-tested function. A
week-over-week completion decline is deliberately NOT a trigger. Six queries
total regardless of project count."
```

---

### Task 7: Attention list and org workload

**Files:**
- Modify: `src/features/executive/queries.ts` (append both queries)

**Interfaces:**
- Consumes: `ExecutiveScope`, `OPEN_STATUSES`, `DAY_MS` from Tasks 5–6.
- Produces:
  - `type AttentionKind = "OVERDUE" | "STUCK_IN_REVIEW" | "UNOWNED_URGENT"`
  - `interface AttentionItem { id: string; taskKey: string; projectId: string; projectKey: string; title: string; kind: AttentionKind; ageDays: number; assigneeName: string | null; canOpen: boolean }`
  - `getAttentionItems(scope?: ExecutiveScope): Promise<AttentionItem[]>`
  - `interface OrgWorkloadEntry { userId: string; name: string; openTasks: number; overdueTasks: number }`
  - `getOrgWorkload(scope?: ExecutiveScope): Promise<OrgWorkloadEntry[]>`

- [ ] **Step 1: Append the attention query**

Add to `src/features/executive/queries.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Needs attention
// ─────────────────────────────────────────────────────────────────────────────

export type AttentionKind = "OVERDUE" | "STUCK_IN_REVIEW" | "UNOWNED_URGENT";

export interface AttentionItem {
  id: string;
  taskKey: string;
  projectId: string;
  projectKey: string;
  title: string;
  kind: AttentionKind;
  /** Days overdue, or days sitting in review — whichever the kind implies. */
  ageDays: number;
  assigneeName: string | null;
  canOpen: boolean;
}

const ATTENTION_CAP = 15;
const REVIEW_STUCK_DAYS = 5;

const KIND_ORDER: Record<AttentionKind, number> = {
  OVERDUE: 0,
  STUCK_IN_REVIEW: 1,
  UNOWNED_URGENT: 2,
};

/**
 * The ranked "needs your attention" list. THE ONLY row-level read in this
 * module — three narrow, individually-capped selects, merged and truncated to
 * ATTENTION_CAP.
 *
 * A task can qualify under more than one rule; it appears ONCE, under its
 * highest-ranked kind (overdue beats stuck-in-review beats unowned-urgent).
 */
export async function getAttentionItems(
  scope?: ExecutiveScope,
): Promise<AttentionItem[]> {
  const s = scope ?? (await getExecutiveScope());

  const now = new Date();
  const reviewCutoff = new Date(now.getTime() - REVIEW_STUCK_DAYS * DAY_MS);

  const select = {
    id: true,
    key: true,
    title: true,
    dueDate: true,
    updatedAt: true,
    projectId: true,
    project: { select: { key: true } },
    assignee: { select: { name: true } },
  } as const;

  const [overdue, stuck, unowned] = await Promise.all([
    prisma.task.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        dueDate: { lt: now },
        priority: { in: ["URGENT", "HIGH"] },
      },
      orderBy: { dueDate: "asc" },
      take: ATTENTION_CAP,
      select,
    }),
    prisma.task.findMany({
      where: { status: "IN_REVIEW", updatedAt: { lt: reviewCutoff } },
      orderBy: { updatedAt: "asc" },
      take: ATTENTION_CAP,
      select,
    }),
    prisma.task.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        priority: "URGENT",
        assigneeId: null,
      },
      orderBy: { createdAt: "asc" },
      take: ATTENTION_CAP,
      select,
    }),
  ]);

  const days = (from: Date): number =>
    Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));

  const seen = new Set<string>();
  const items: AttentionItem[] = [];

  const push = (
    rows: typeof overdue,
    kind: AttentionKind,
    age: (row: (typeof overdue)[number]) => number,
  ): void => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push({
        id: row.id,
        taskKey: row.key,
        projectId: row.projectId,
        projectKey: row.project.key,
        title: row.title,
        kind,
        ageDays: age(row),
        assigneeName: row.assignee?.name ?? null,
        canOpen: s.memberProjectIds.has(row.projectId),
      });
    }
  };

  // Order of these three calls IS the precedence — `seen` keeps the first win.
  push(overdue, "OVERDUE", (r) => (r.dueDate ? days(r.dueDate) : 0));
  push(stuck, "STUCK_IN_REVIEW", (r) => days(r.updatedAt));
  push(unowned, "UNOWNED_URGENT", () => 0);

  return items
    .sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.ageDays - a.ageDays,
    )
    .slice(0, ATTENTION_CAP);
}
```

- [ ] **Step 2: Append the org workload query**

```ts
// ─────────────────────────────────────────────────────────────────────────────
// People & workload
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgWorkloadEntry {
  userId: string;
  name: string;
  openTasks: number;
  overdueTasks: number;
}

const WORKLOAD_LIMIT = 10;

/**
 * Open task counts per assignee across EVERY project, busiest first, top 10.
 * Three queries: two groupBys plus one name lookup — never task rows.
 */
export async function getOrgWorkload(
  scope?: ExecutiveScope,
): Promise<OrgWorkloadEntry[]> {
  if (!scope) await requireExecutive();

  const now = new Date();

  const [open, overdue] = await Promise.all([
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: { status: { in: [...OPEN_STATUSES] }, assigneeId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { assigneeId: "desc" } },
      take: WORKLOAD_LIMIT,
    }),
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: {
        status: { in: [...OPEN_STATUSES] },
        assigneeId: { not: null },
        dueDate: { lt: now },
      },
      _count: { _all: true },
    }),
  ]);

  const userIds = open
    .map((g) => g.assigneeId)
    .filter((id): id is string => id !== null);
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const overdueOf = new Map(
    overdue.map((g) => [g.assigneeId, g._count._all] as const),
  );

  return userIds.map((id) => ({
    userId: id,
    name: nameOf.get(id) ?? "Unknown",
    openTasks: open.find((g) => g.assigneeId === id)?._count._all ?? 0,
    overdueTasks: overdueOf.get(id) ?? 0,
  }));
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/executive/queries.ts
git commit -m "feat(executive): attention list and org-wide workload queries

The attention list is the only row-level read in the module: three capped
selects merged with precedence (overdue > stuck-in-review > unowned-urgent), a
task appearing once under its highest-ranked kind."
```

---

### Task 8: Executive UI components

**Files:**
- Create: `src/features/executive/components/OrgThroughputChart.tsx`
- Create: `src/features/executive/components/ProjectHealthCard.tsx`
- Create: `src/features/executive/components/AttentionList.tsx`
- Create: `src/features/executive/components/OrgWorkloadBars.tsx`

**Interfaces:**
- Consumes: `OrgThroughputWeek`, `ExecutiveProject`, `AttentionItem`, `OrgWorkloadEntry` (Tasks 5–7); `HEALTH_META` (Task 6).
- Produces: `OrgThroughputChart`, `ProjectHealthCard`, `AttentionList`, `OrgWorkloadBars` — consumed by Task 9's page.

- [ ] **Step 1: Create the throughput chart**

Create `src/features/executive/components/OrgThroughputChart.tsx`. This is the only client component in the set (recharts needs the DOM); everything else stays server-rendered with zero JS.

```tsx
"use client";

// Created vs completed per week — "is the org keeping up with what it takes
// on?". Themed exclusively through CSS variables so globals.css stays the
// single source of colour.

import * as React from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { OrgThroughputWeek } from "../queries";

const ANIMATION_MS = 300;
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
}

function PanelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border bg-surface-raised rounded-lg border px-2.5 py-1.5 shadow-lg shadow-black/30">
      <p className="text-muted-foreground mb-0.5 text-[11px]">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-foreground text-xs" style={{ color: entry.color }}>
          {entry.name}: <span className="tabular-nums">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function OrgThroughputChart({ data }: { data: OrgThroughputWeek[] }) {
  const createdId = React.useId();
  const completedId = React.useId();
  const total = data.reduce((sum, d) => sum + d.created + d.completed, 0);

  if (total === 0) {
    return (
      <div className="text-muted-foreground flex h-48 items-center justify-center text-sm">
        No activity in the last 8 weeks
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Tasks created versus completed per week over the last 8 weeks"
      className="h-48"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={createdId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--info)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={completedId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<PanelTooltip />} cursor={{ stroke: "var(--border)" }} />
          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="var(--info)"
            strokeWidth={1.5}
            fill={`url(#${createdId})`}
            dot={false}
            animationDuration={ANIMATION_MS}
          />
          <Area
            type="monotone"
            dataKey="completed"
            name="Completed"
            stroke="var(--success)"
            strokeWidth={1.5}
            fill={`url(#${completedId})`}
            dot={false}
            animationDuration={ANIMATION_MS}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Create the project health card**

Create `src/features/executive/components/ProjectHealthCard.tsx`:

```tsx
import Link from "next/link";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { HEALTH_META } from "../health";
import type { ExecutiveProject } from "../queries";

const SPARK_WEEKS = 6;

/**
 * Six-week completion sparkline as CSS bars — no charting library, no client
 * JS, no layout animation. `weeks` may be short or empty when a project has no
 * completions in the window; it is left-padded to SPARK_WEEKS so every card's
 * strip is the same width and the cards stay on one grid.
 */
function Sparkline({ weeks }: { weeks: number[] }) {
  const padded = [
    ...Array.from({ length: Math.max(0, SPARK_WEEKS - weeks.length) }, () => 0),
    ...weeks.slice(-SPARK_WEEKS),
  ];
  const max = Math.max(1, ...padded);
  const total = padded.reduce((sum, n) => sum + n, 0);

  return (
    <div
      role="img"
      aria-label={
        total === 0
          ? "No tasks completed in the last 6 weeks"
          : `${total} tasks completed over the last 6 weeks`
      }
      className="flex h-6 items-end gap-1"
    >
      {padded.map((count, i) => (
        <span
          key={i}
          className={cn(
            "min-h-[2px] flex-1 rounded-sm",
            count === 0 ? "bg-surface-raised" : "bg-success/60",
          )}
          style={{ height: `${(count / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * One project, at a glance. Server component, zero JS.
 *
 * A project the viewer has no ProjectMembership for renders as a NON-LINK with
 * a lock — the Overview is org-wide but drill-down stays membership-gated.
 */
export function ProjectHealthCard({ project }: { project: ExecutiveProject }) {
  const meta = HEALTH_META[project.health];
  const pct =
    project.total === 0 ? 0 : Math.round((project.done / project.total) * 100);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground font-mono text-[11px]">
            {project.key}
          </span>
          <span className="text-foreground truncate text-sm font-medium">
            {project.name}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap",
            meta.chipClass,
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.dotClass)} aria-hidden />
          {meta.label}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-muted-foreground flex items-baseline justify-between text-[11px]">
          <span>
            {project.done} of {project.total} done
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <span aria-hidden className="bg-surface-raised h-1.5 overflow-hidden rounded-full">
          <span
            className="bg-success block h-full rounded-full"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>

      <dl className="text-muted-foreground grid grid-cols-3 gap-2 text-[11px]">
        <div className="flex flex-col">
          <dt>Open</dt>
          <dd className="text-foreground tabular-nums">{project.open}</dd>
        </div>
        <div className="flex flex-col">
          <dt>In review</dt>
          <dd className="text-foreground tabular-nums">{project.inReview}</dd>
        </div>
        <div className="flex flex-col">
          <dt>Overdue</dt>
          <dd
            className={cn(
              "tabular-nums",
              project.overdue > 0 ? "text-danger" : "text-foreground",
            )}
          >
            {project.overdue}
          </dd>
        </div>
      </dl>

      <Sparkline weeks={project.spark} />

      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
        <span className="truncate">Lead: {project.leadName}</span>
        <span className="flex items-center gap-1">
          {project.activity7d} updates / 7d
          {project.canOpen ? null : <Lock aria-hidden className="size-3" />}
        </span>
      </div>
    </>
  );

  const shell = "glass flex flex-col gap-3 p-4";

  if (!project.canOpen) {
    return (
      <div
        className={cn(shell, "opacity-70")}
        title="No project access — ask an admin"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={`/projects/${project.key}`}
      className={cn(
        shell,
        "transition-colors duration-150 motion-reduce:transition-none",
        "hover:bg-surface-raised/50 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {body}
    </Link>
  );
}
```

`project.spark` is rendered by the local `Sparkline` — CSS bars, not recharts, so the card stays a zero-JS Server Component. `getProjectHealth` returns `[]` for a project with no completions in the window, which the padding handles.

- [ ] **Step 3: Create the attention list**

Create `src/features/executive/components/AttentionList.tsx`:

```tsx
import Link from "next/link";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AttentionItem, AttentionKind } from "../queries";

const KIND_META: Record<AttentionKind, { dotClass: string; label: (days: number) => string }> = {
  OVERDUE: {
    dotClass: "bg-danger",
    label: (days) => (days === 1 ? "1 day overdue" : `${days} days overdue`),
  },
  STUCK_IN_REVIEW: {
    dotClass: "bg-warning",
    label: (days) => `${days} days in review`,
  },
  UNOWNED_URGENT: {
    dotClass: "bg-warning",
    label: () => "Urgent, unassigned",
  },
};

/** Ranked risk list. Server component, zero JS. Locked rows are non-links. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing needs attention — no overdue, stalled, or unowned urgent work.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const meta = KIND_META[item.kind];
        const row = (
          <>
            <span className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)} aria-hidden />
            <span className="text-muted-foreground w-16 shrink-0 font-mono text-[11px]">
              {item.taskKey}
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate">{item.title}</span>
            <span className="text-muted-foreground hidden shrink-0 text-[11px] sm:inline">
              {item.assigneeName ?? "Unassigned"}
            </span>
            <span className="text-muted-foreground w-28 shrink-0 text-right text-[11px]">
              {meta.label(item.ageDays)}
            </span>
            {item.canOpen ? null : <Lock aria-hidden className="text-muted-foreground size-3" />}
          </>
        );

        return (
          <li key={item.id} className="border-border/60 border-b last:border-b-0">
            {item.canOpen ? (
              <Link
                href={`/browse/${item.taskKey}`}
                className={cn(
                  "flex items-center gap-2 py-2 text-sm",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  "hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
              >
                {row}
              </Link>
            ) : (
              <div
                className="flex items-center gap-2 py-2 text-sm opacity-70"
                title="No project access — ask an admin"
              >
                {row}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Create the org workload bars**

Create `src/features/executive/components/OrgWorkloadBars.tsx`:

```tsx
import type { OrgWorkloadEntry } from "../queries";

/**
 * Open tasks per person org-wide. Each bar is proportional to the busiest
 * person; the overdue portion is drawn in --danger inside the same bar, so
 * "loaded" and "late" read as one shape rather than two numbers.
 */
export function OrgWorkloadBars({ data }: { data: OrgWorkloadEntry[] }) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">No open tasks assigned.</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.openTasks));

  return (
    <ul className="flex flex-col gap-2">
      {data.map((entry) => {
        const overdue = Math.min(entry.overdueTasks, entry.openTasks);
        return (
          <li key={entry.userId} className="flex items-center gap-2 text-sm">
            <span className="text-foreground w-28 shrink-0 truncate" title={entry.name}>
              {entry.name}
            </span>
            <span
              aria-hidden
              className="bg-surface-raised flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
            >
              <span
                className="bg-danger block h-full"
                style={{ width: `${(overdue / max) * 100}%` }}
              />
              <span
                className="bg-info block h-full"
                style={{ width: `${((entry.openTasks - overdue) / max) * 100}%` }}
              />
            </span>
            <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
              {entry.openTasks}
              {overdue > 0 ? <span className="text-danger"> ({overdue})</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/executive/components
git commit -m "feat(executive): overview UI components

Health card, attention list, workload bars are server components with zero JS;
only the throughput chart is client (recharts). Projects and tasks the viewer
has no membership for render as locked non-links."
```

---

### Task 9: Compose the `/executive` page

**Files:**
- Modify: `src/app/(dashboard)/executive/page.tsx` (replace the Task 3 shell)

**Interfaces:**
- Consumes: everything from Tasks 5–8, plus the existing `KpiCard` (`@/features/dashboard/components/KpiCard`), `ThroughputSpark` (`@/features/dashboard/components/ThroughputSpark`), and `DashboardEntrance` (`@/features/dashboard/components/DashboardEntrance`).
- Produces: the finished page.

- [ ] **Step 1: Replace the page**

`ThroughputSpark` takes `{ label, completed }[]`, so map the org series down for the strip. `DashboardEntrance` is reused deliberately — it is the app's one sanctioned entrance and is already session-gated and reduced-motion-aware.

```tsx
import {
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  ListTodo,
} from "lucide-react";

import { requireExecutive } from "@/lib/permissions";
import { KpiCard } from "@/features/dashboard/components/KpiCard";
import { ThroughputSpark } from "@/features/dashboard/components/ThroughputSpark";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";
import {
  getAttentionItems,
  getExecutiveKpis,
  getExecutiveScope,
  getOrgThroughput,
  getOrgWorkload,
  getProjectHealth,
} from "@/features/executive/queries";
import { AttentionList } from "@/features/executive/components/AttentionList";
import { OrgThroughputChart } from "@/features/executive/components/OrgThroughputChart";
import { OrgWorkloadBars } from "@/features/executive/components/OrgWorkloadBars";
import { ProjectHealthCard } from "@/features/executive/components/ProjectHealthCard";

/** Small-caps muted section heading — same chrome as /dashboard and /manager. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
      {children}
    </h2>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass flex flex-col gap-3 p-5">
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

/**
 * Executive Overview — org-wide project health for the EXECUTIVE role.
 *
 * SCOPING (deliberate, documented): unlike /dashboard (personal) and /manager
 * (team-scoped), every figure here spans EVERY project regardless of the
 * viewer's memberships. Drill-down stays membership-gated — cards and rows for
 * projects the viewer cannot open render locked and non-navigable.
 *
 * FAST FIRST: one scope resolve, then six aggregate queries in parallel. The
 * entrance tween runs after paint and never gates data, layout, or clicks.
 */
export default async function ExecutivePage() {
  await requireExecutive();

  const scope = await getExecutiveScope();
  const [kpis, throughput, attention, projects, workload] = await Promise.all([
    getExecutiveKpis(scope),
    getOrgThroughput(scope),
    getAttentionItems(scope),
    getProjectHealth(scope),
    getOrgWorkload(scope),
  ]);

  const sparkData = throughput.map((w) => ({
    label: w.label,
    completed: w.completed,
  }));

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Every project across the organisation.
          </p>
        </div>

        {/* A. Org KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Open work"
            value={kpis.open}
            icon={ListTodo}
            iconClass="text-info"
            delta={{ value: kpis.open - kpis.openLastWeek, meaning: "up-bad" }}
          />
          <KpiCard
            label="Completed this week"
            value={kpis.completedThisWeek}
            icon={CheckCircle2}
            iconClass="text-success"
            delta={{
              value: kpis.completedThisWeek - kpis.completedLastWeek,
              meaning: "up-good",
            }}
          />
          <KpiCard
            label="Overdue"
            value={kpis.overdue}
            icon={AlertTriangle}
            iconClass="text-danger"
            delta={{
              value: kpis.overdue - kpis.overdueLastWeek,
              meaning: "up-bad",
            }}
          />
          <KpiCard
            label="In review"
            value={kpis.inReview}
            icon={Hourglass}
            iconClass="text-warning"
            caption="awaiting sign-off"
          />
        </div>

        <div className="glass p-5">
          <ThroughputSpark data={sparkData} />
        </div>

        {/* B. Attention + throughput */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel title="Needs attention">
              <AttentionList items={attention} />
            </Panel>
          </div>
          <Panel title="Created vs completed">
            <OrgThroughputChart data={throughput} />
          </Panel>
        </div>

        {/* C. Project health board */}
        <div className="flex flex-col gap-3">
          <SectionHeading>Projects</SectionHeading>
          {projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <ProjectHealthCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>

        {/* D. People & workload */}
        <Panel title="People & workload">
          <OrgWorkloadBars data={workload} />
        </Panel>
      </div>
    </DashboardEntrance>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `npm run dev`, set your user's `globalRole` to `EXECUTIVE` in `npx prisma studio`, visit `/executive`.
Expected: KPI row with deltas, an attention list, a throughput chart, project cards sorted worst-first, and workload bars. Projects you are not a member of appear dimmed with a lock and are not clickable.

- [ ] **Step 3: Check for horizontal overflow at mobile width**

Run: resize the browser to 390px wide.
Expected: no horizontal page scroll; KPI cards fall to 2 columns, project cards to 1.

- [ ] **Step 4: Verify build, types, lint, and tests**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/executive/page.tsx
git commit -m "feat(executive): compose the Overview page

One scope resolve then six aggregates in parallel. Reuses KpiCard,
ThroughputSpark, and the single sanctioned DashboardEntrance tween, which runs
after paint and never gates data or clicks."
```

---

### Task 10: "Grant viewer access to all projects" admin action

Makes the CEO's locked project cards clickable in one click instead of one grant per project.

**Files:**
- Modify: `src/features/admin/schemas.ts` (append the schema)
- Modify: `src/features/admin/actions.ts` (append the action)
- Create: `src/features/admin/components/GrantAllProjectsButton.tsx`
- Modify: `src/app/(dashboard)/admin/users/[userId]/page.tsx`
- Test: `src/features/admin/actions.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` and the existing `ActionResult` type from `src/features/admin/actions.ts`.
- Produces: `grantAllProjectsViewer(input: unknown): Promise<ActionResult>` and the `GrantAllProjectsButton` client component.

- [ ] **Step 1: Add the Zod schema**

Append to `src/features/admin/schemas.ts`:

```ts
/** Bulk VIEWER grant across every project the user isn't already in. */
export const grantAllProjectsViewerSchema = z.object({
  userId: z.string().min(1),
});
```

- [ ] **Step 2: Write the failing test**

Append to `src/features/admin/actions.test.ts` (add `grantAllProjectsViewer` to the `from "./actions"` import). Reuse `db`, `mockRequireAdmin`, and `mockRecomputeMembership` — all already configured in the shared `beforeEach`.

```ts
describe("grantAllProjectsViewer", () => {
  it("rejects invalid input before touching the DB", async () => {
    const result = await grantAllProjectsViewer({ userId: "" });

    expect(result).toEqual({ ok: false, error: "Invalid input." });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("reports a no-op when the user already has a row for every project", async () => {
    db.user.findUnique.mockResolvedValue({ id: USER_ID });
    db.project.findMany.mockResolvedValue([{ id: PROJECT_ID }]);
    db.projectMembership.findMany.mockResolvedValue([{ projectId: PROJECT_ID }]);

    const result = await grantAllProjectsViewer({ userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("upserts manualRole VIEWER and recomputes only the projects with no row", async () => {
    db.user.findUnique.mockResolvedValue({ id: USER_ID });
    db.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    db.projectMembership.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.projectMembership.upsert.mockResolvedValue({});

    const result = await grantAllProjectsViewer({ userId: USER_ID });

    expect(result).toEqual({ ok: true });
    // p1 already has a row (possibly a HIGHER team-derived role) — untouched.
    expect(db.projectMembership.upsert).toHaveBeenCalledTimes(1);
    expect(db.projectMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: "p2", userId: USER_ID } },
        update: { manualRole: "VIEWER" },
      }),
    );
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p2", USER_ID);
    expect(mockRecomputeMembership).not.toHaveBeenCalledWith(db, "p1", USER_ID);
  });

  it("audits the bulk grant once with the created project ids", async () => {
    db.user.findUnique.mockResolvedValue({ id: USER_ID });
    db.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    db.projectMembership.findMany.mockResolvedValue([]);
    db.projectMembership.upsert.mockResolvedValue({});

    await grantAllProjectsViewer({ userId: USER_ID });

    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "membership.granted_all",
          targetType: "User",
          targetId: USER_ID,
          metadata: { projectRole: "VIEWER", projectIds: ["p1", "p2"] },
        }),
      }),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/admin/actions.test.ts -t "grantAllProjectsViewer"`
Expected: FAIL — `grantAllProjectsViewer` is not exported from `./actions`.

- [ ] **Step 4: Implement the action**

Append to `src/features/admin/actions.ts` (add `grantAllProjectsViewerSchema` to the existing schema import).

**Critical: `ProjectMembership.projectRole` is a COMPUTED column, not a value you write.** Per the A4 refactor, `projectRole` is the *effective* role derived by `recomputeMembership` (in `@/lib/access-sync`) from `manualRole` + team-derived roles + project-lead status. Writing `projectRole` directly — e.g. with a bulk `createMany` — produces rows with `manualRole: null` that the next `recomputeMembership` call (triggered by any unrelated team edit) would find sourceless and **delete**. The grant would silently evaporate. Follow `addProjectMember`: upsert `manualRole`, then recompute.

```ts
/**
 * Grant a user VIEWER access to EVERY project they have no membership row for.
 *
 * A convenience wrapper over the ordinary membership model, not a new
 * permission concept: it writes plain `manualRole = VIEWER` rows, revocable
 * one-by-one through the normal editor.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION: projects where a ProjectMembership row
 * already exists are skipped entirely, so a higher role — whether manual or
 * derived from a team or a lead assignment — is never touched, let alone
 * downgraded. Re-running the action is a no-op.
 *
 * Intended for an EXECUTIVE whose Overview lists every project but who can only
 * open the ones they hold a membership for.
 */
export async function grantAllProjectsViewer(input: unknown): Promise<ActionResult> {
  try {
    const parsed = grantAllProjectsViewerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };
    const { userId } = parsed.data;

    const admin = await requireAdmin();

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) return { ok: false, error: "User not found." };

    const [projects, existing] = await Promise.all([
      prisma.project.findMany({ select: { id: true } }),
      prisma.projectMembership.findMany({
        where: { userId },
        select: { projectId: true },
      }),
    ]);

    const held = new Set(existing.map((m) => m.projectId));
    const missing = projects.filter((p) => !held.has(p.id)).map((p) => p.id);
    if (missing.length === 0) return { ok: true }; // already everywhere — no-op

    await prisma.$transaction(async (tx) => {
      for (const projectId of missing) {
        await tx.projectMembership.upsert({
          where: { projectId_userId: { projectId, userId } },
          update: { manualRole: "VIEWER" },
          create: {
            projectId,
            userId,
            projectRole: "VIEWER",
            manualRole: "VIEWER",
          },
        });
        // Resolve the EFFECTIVE role from every source (manual + team + lead).
        await recomputeMembership(tx, projectId, userId);
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "membership.granted_all",
          targetType: "User",
          targetId: userId,
          metadata: { projectRole: "VIEWER", projectIds: missing },
        },
      });
    });

    for (const projectId of missing) revalidateMembership(projectId, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}
```

`recomputeMembership`, `revalidateMembership`, and `friendlyAuthError` are all already imported/defined in this file — do not redefine them.

A sequential loop is correct here: the upserts share one transaction and `recomputeMembership` reads rows the previous iteration may have written. Project counts in this app are in the tens, not thousands.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/admin/actions.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Create the button**

Create `src/features/admin/components/GrantAllProjectsButton.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { grantAllProjectsViewer } from "../actions";

/**
 * One-click VIEWER grant across every project — for an EXECUTIVE whose Overview
 * lists every project but who can only open the ones they're a member of.
 * Idempotent and non-destructive: existing higher roles are never downgraded.
 */
export function GrantAllProjectsButton({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await grantAllProjectsViewer({ userId });
          if (result.ok) {
            toast.success(`${userName} can now view every project.`);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {isPending ? "Granting…" : "Grant viewer access to all projects"}
    </Button>
  );
}
```

- [ ] **Step 7: Place the button on the user detail page**

In `src/app/(dashboard)/admin/users/[userId]/page.tsx`, import the component and add it to the "Project access" header block, beside the existing description:

```tsx
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-base font-semibold text-foreground">Project access</h3>
            <p className="text-sm text-muted-foreground">
              Grant this user access to a project and set their role. Roles: Manager
              (manage the project &amp; members), Member (create/edit tasks), Viewer
              (read-only).
            </p>
          </div>
          <GrantAllProjectsButton userId={user.id} userName={user.name} />
        </div>
```

(Replace the existing `<div className="flex flex-col gap-0.5">…</div>` wrapper with the block above; leave `<MembershipEditor …/>` beneath it untouched.)

- [ ] **Step 8: Verify manually**

Run: `npm run dev`, go to `/admin/users/<ceo-id>`, click the button.
Expected: a success toast, the membership table fills with every project at Viewer, and `/executive` now shows all cards clickable. Click again — a second success with no duplicate rows. Check `/admin/audit` shows one `membership.granted_all` entry.

- [ ] **Step 9: Commit**

```bash
git add src/features/admin src/app/\(dashboard\)/admin/users
git commit -m "feat(admin): grant viewer access to all projects in one action

Idempotent bulk VIEWER grant, never downgrading an existing higher role, in a
single transaction with one membership.granted_all audit entry. Makes an
executive's Overview cards clickable without granting project-by-project."
```

---

### Task 11: End-to-end coverage

**Files:**
- Create: `e2e/executive.spec.ts`

**Interfaces:**
- Consumes: everything above. Read `e2e/helpers.ts` and `e2e/auth.setup.ts` first — the suite signs in through a stored auth state, and these tests need a second, `EXECUTIVE`-role user.

- [ ] **Step 1: Write the spec**

Create `e2e/executive.spec.ts`. Adapt the sign-in and seeding to whatever `e2e/helpers.ts` already exposes rather than inventing new helpers.

```ts
import { expect, test } from "@playwright/test";

test.describe("executive overview", () => {
  test("an admin can reach the overview and sees org-wide sections", async ({ page }) => {
    await page.goto("/executive");

    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await expect(page.getByText("Open work")).toBeVisible();
    await expect(page.getByText("Completed this week")).toBeVisible();
    await expect(page.getByText("Needs attention")).toBeVisible();
    await expect(page.getByText("People & workload")).toBeVisible();
  });

  test("the Overview nav link is present for an admin", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  });

  test("KPI numbers are readable immediately, not animated in", async ({ page }) => {
    await page.goto("/executive");
    // The value is server-rendered — assert it is non-empty on first paint.
    const openCard = page.locator("div").filter({ hasText: /^Open work/ }).first();
    await expect(openCard).toContainText(/\d/);
  });
});
```

- [ ] **Step 2: Add the unauthenticated-access test**

Append to the same file.

**Coverage limit, stated deliberately:** the e2e suite has exactly one stored session — the seeded admin (`e2e/auth.setup.ts` → `ADMIN_STORAGE_STATE`). Two cases from the spec's test list therefore cannot be asserted end-to-end and are **not** covered here:

1. *"A plain USER is redirected away from `/executive`."* Covered by unit tests instead — `requireExecutive` rejects `USER` with `FORBIDDEN` (Task 2) — and the `proxy.ts` branch is a two-line mirror of the already-proven `/admin` branch.
2. *"A project card without membership is not a link."* An admin passes `getExecutiveScope`'s bypass, so `canOpen` is `true` for every card in this session and the locked state never renders.

Both need a second, non-admin storage state, which is out of scope for this plan. Do not silently skip them, and do not pretend they are covered.

What *is* verifiable without new fixtures is the anonymous gate:

```ts
test.describe("executive overview — access control", () => {
  // Anonymous context: no stored session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an anonymous visitor is sent to login with a callback", async ({ page }) => {
    await page.goto("/executive");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fexecutive/);
  });
});
```

- [ ] **Step 3: Confirm the existing auth setup still passes**

Task 4 changed the login form's default redirect from `/dashboard` to `/`. `e2e/auth.setup.ts` asserts `await expect(page).toHaveURL(/\/dashboard/)` after signing in as the seeded admin — that still holds, because `/` server-redirects an admin straight to `/dashboard`, and `toHaveURL` retries through the intermediate hop.

Run: `npm run test:e2e -- auth.setup.ts auth.spec.ts`
Expected: PASS. If the admin storage state fails to save, the redirect chain is the first thing to check.

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e -- executive.spec.ts`
Expected: PASS. The local Postgres (`flux_dev`) must be running and seeded — the e2e suite signs in with the seeded admin credentials from `.env.local`.

- [ ] **Step 5: Run the full check**

Run: `npm run lint && npm run test && npm run build && npm run test:e2e`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add e2e/executive.spec.ts
git commit -m "test(e2e): executive overview access control and content

Covers the admin-visible route and nav link, server-rendered KPI values, and
the anonymous redirect to login. The plain-USER redirect is covered by unit
tests instead — the suite has only an admin storage state."
```

---

## Deployment note

`prisma/migrations` gains one migration. The production box (`flux.foodverse.io`, pm2 process `flux`) runs against the box-local Postgres. Deploy runs `npx prisma migrate deploy` before the pm2 reload as usual — `ALTER TYPE … ADD VALUE` is additive and requires no downtime or backfill. After deploying, promote the CEO's account to `EXECUTIVE` from `/admin/users/<id>` and click **Grant viewer access to all projects**.

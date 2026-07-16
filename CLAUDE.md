# CLAUDE.md — Flux

Guidance for Claude Code when working in this repository.

## Project

**Flux** — an internal task & project management web app; a lightweight, self-hosted "Jira for one organisation." The name reflects work constantly moving through stages. Single-tenant: all users belong to the same company. Controlled onboarding only (invite + admin-created accounts — no open public sign-up), no billing, no multi-org support. Optimise for **simplicity and maintainability** over feature breadth.

**Domain:** `flux.foodverse.io` (part of the Foodverse / ICCA digital ecosystem). Use this as the canonical base URL for auth callbacks, CORS, cookie domain, and any absolute-URL generation — read it from an env var (`NEXT_PUBLIC_APP_URL`), never hardcode.

**Core scope (v1):**
- Projects (containers for work)
- Tasks / issues (title, rich-text description, type, status, priority, assignee, reporter, labels, due date)
- Subtasks
- Kanban board (drag-and-drop across status columns)
- Backlog / list view with filtering & search
- Rich-text comments on tasks
- File attachments on tasks (stored in Cloudflare R2)
- User onboarding — invite-based registration + admin-created accounts (no open sign-up); email/password or SSO
- Access control — a minimal global role (Admin vs. regular User) plus **per-project roles** (a user's permissions are granted per project, not globally)
- Admin dashboard — manage users, send invites, and grant/revoke per-project role-based access (see **Admin Dashboard** below)
- User profiles — each user can edit their own basic profile (display name, username, bio) and upload/change an avatar image (stored in Cloudflare R2)
- Dashboard — a next-level landing view with KPIs, charts, and personal work at a glance (see **Dashboard** below)
- Activity log / audit trail per task

**Explicitly out of scope for v1** (don't build unless asked): sprints/velocity charts, custom workflows, automation rules, time tracking, external integrations, mobile app.

## Tech Stack

Pin these versions; verify with `npm show <pkg> version` before upgrading.

- **Framework:** Next.js 16 (App Router, Server Components, Server Actions). Turbopack is the default bundler.
- **Language:** TypeScript (strict mode on).
- **React:** 19.2 (bundled with Next 16 App Router).
- **Database:** PostgreSQL 16+.
- **ORM:** Prisma (with migrations — do NOT rely on schema auto-sync/`db push` in anything beyond local dev).
- **Auth:** Auth.js (NextAuth v5) with credentials or your org's SSO/OIDC provider. Sessions via JWT or database sessions. Registration is invite/admin-gated — see **Onboarding & Registration**. Authorisation is two-tier (global role + per-project membership) — see **Security Requirements**.
- **Styling:** Tailwind CSS + shadcn/ui components. Black dark theme with Foodverse orange accent, glassmorphism, Outfit typeface — see **Look & Feel** below.
- **Animation:** GSAP + `@gsap/react` (`useGSAP`) for the few orchestrated moments; CSS transitions for everyday micro-interactions. Speed over spectacle — see **Motion & Animation**.
- **Component registry:** shadcn/ui as the base, plus 21st.dev components where they elevate the UI — see **Component Sources**.
- **Data fetching (client):** TanStack Query (React Query) for client-side mutations/caching where Server Actions aren't sufficient.
- **Drag & drop:** dnd-kit (accessible, well-maintained).
- **Rich-text editor:** Tiptap (headless, ProseMirror-based) for task descriptions and comments. Store content as sanitised HTML or ProseMirror JSON — pick one and be consistent. Sanitise on the server before persisting.
- **File storage:** Cloudflare R2 (S3-compatible), accessed via the AWS SDK v3 S3 client (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). Uploads/downloads use presigned URLs — see **File Attachments** below.
- **Forms & validation:** react-hook-form + Zod. Zod schemas are the single source of truth — reuse them on both client and server.
- **Testing:** Vitest + React Testing Library (unit/integration); Playwright (e2e).
- **Linting/formatting:** ESLint + Prettier.

> Note: Next 16 request APIs (`cookies()`, `headers()`, `params`) are async — always `await` them. Middleware lives in `proxy.ts` (renamed from `middleware.ts`).

## Look & Feel

**Dark theme by default**, black surfaces with the Foodverse orange accent. The app ships dark-only for v1 (no light-mode toggle unless asked).

**Brand accent:** `#FF6B35` (Foodverse orange). Backgrounds are near-black rather than the Foodverse navy.

Define these as CSS variables in `globals.css` and map them into the Tailwind theme + shadcn tokens. Never hardcode hex values in components — always reference the token.

```css
:root {
  /* Surfaces (black-derived, stepped for elevation) */
  --background:        #0A0A0A;  /* app base — near-black */
  --surface:          #141414;  /* cards, board columns */
  --surface-raised:   #1F1F1F;  /* hover, popovers, modals */
  --border:           #2A2A2A;  /* dividers, input borders */

  /* Accent (Foodverse orange) */
  --primary:          #FF6B35;
  --primary-hover:    #FF8355;
  --primary-fg:       #0A0A0A;  /* text on orange buttons */

  /* Text */
  --foreground:       #F5F5F7;  /* headings, body */
  --muted-foreground: #9A9A9A;  /* secondary text, labels */

  /* Functional (status/priority — don't make the board all-orange) */
  --success:          #3CCF91;  /* Done */
  --warning:          #F5A623;  /* In Review */
  --info:             #5B8DEF;  /* In Progress */
  --danger:           #F5455C;  /* Urgent / Bug */

  /* Glassmorphism (frosted panels — see Glassmorphism below) */
  --glass-bg:         rgba(255, 255, 255, 0.04);  /* panel fill */
  --glass-border:     rgba(255, 255, 255, 0.08);  /* hairline edge */
  --glass-highlight:  rgba(255, 255, 255, 0.12);  /* top inner highlight */
  --glass-blur:       16px;                        /* backdrop-filter blur */
}
```

Guidance:
- **Pure black vs. near-black:** use `#0A0A0A` for the base rather than `#000000` — true black against bright orange causes harsh haloing/eye strain, and near-black lets card elevation and glass panels read. Only go full `#000000` if you specifically want an OLED look.
- **Orange is the accent, not the background.** Use `--primary` for primary buttons, active nav, links, focus rings, and selected states — not for large fills.
- **Status columns / chips** use the functional colours above (Todo = muted, In Progress = info, In Review = warning, Done = success). Priority badges: Low = muted, Medium = info, High = warning, Urgent = danger.
- **Contrast:** body text and interactive elements must meet WCAG AA against the black surfaces. `--muted-foreground` is the floor for readable text — don't go dimmer.
- **Elevation via surface lightness**, not heavy shadows — cards sit on `--surface`, hover/raised states step up to `--surface-raised`.
- Keep the shadcn/ui `dark` token set aligned to these variables so all primitives inherit the theme automatically.

### Glassmorphism

Frosted-glass panels are a signature of the look — used on the sidebar, top bar, modals, popovers, the task detail drawer, and dashboard cards. A reusable `.glass` utility/class:

```css
.glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  box-shadow: inset 0 1px 0 var(--glass-highlight),  /* top highlight */
              0 8px 32px rgba(0, 0, 0, 0.40);        /* soft drop */
  border-radius: 16px;
}
```

Rules so glass looks premium, not muddy:
- **Needs something behind it.** Glass only reads against a textured/gradient backdrop — place a subtle dark gradient or soft orange radial glow on `--background` so the blur has something to refract. Flat black behind glass looks like a plain grey box.
- **Restraint.** Don't stack glass on glass. One frosted layer over the backdrop; nested cards use solid `--surface`, not more glass.
- **Performance:** `backdrop-filter` is GPU-cheap for a few panels but expensive if applied to dozens of scrolling cards. Use glass on chrome (nav, drawers, modals, KPI cards) — not on every task card in a long list.
- **Accessibility fallback:** if the browser lacks `backdrop-filter` support, fall back to a solid `--surface-raised`. Respect `prefers-reduced-transparency` where available.

**Typography:** Use **Outfit** as the primary typeface across the whole app (UI, headings, body). Load it via `next/font/google` for self-hosting and zero layout shift, and expose it as a CSS variable wired into the Tailwind theme.

```ts
// app/layout.tsx
import { Outfit } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

// <html className={outfit.variable}> ... then set Tailwind fontFamily.sans to var(--font-outfit)
```

- Outfit is a geometric sans with a clean, modern feel that pairs well with the black + orange theme.
- Use a monospace fallback (e.g. the system mono stack) only for task keys / code snippets, not for general UI.

## Motion & Animation

**Speed first. Animation is used only where it aids comprehension or gives feedback — never for spectacle, and never at the cost of dashboard performance.** This is a tool people use all day; a slow or busy interface is a failure, no matter how polished the motion looks. When in doubt, ship no animation.

**Library: GSAP** (with `@gsap/react`'s `useGSAP` hook for React-safe, auto-cleaned timelines) for the few orchestrated moments that warrant it. Use plain CSS transitions for the common micro-interactions — they're cheaper and enough for hover/press/focus. dnd-kit already owns the drag physics on the board — don't animate over it.

**Where animation IS worth it** (functional — it tells the user something):
- **Micro-feedback:** button press, hover state, focus ring, input validation — CSS transitions, 120–200ms. These confirm an action registered.
- **State changes:** toast/notification slide-in, drawer/modal open-close, task moving status. Short and immediate.
- **A single, restrained dashboard entrance** — a quick fade/rise on first load only (see limits below). One time, then never again on re-render or navigation back.

**Where animation is NOT worth it** (cut these — they cost speed and attention):
- Per-card stagger across long task lists / board columns — reflows and re-animates on every filter, sort, and data change. Render instantly instead.
- Scroll-driven reveals inside the app (ScrollTrigger) — fine for a marketing page, wrong for a work tool.
- Count-up on numbers if it delays the real value being readable. If used at all, keep it under ~400ms and never block interaction.
- Route-transition animations that add perceived latency between pages.

**Hard performance rules:**
- **The dashboard must render and be interactive fast.** Data-driven content appears immediately; any entrance animation runs *after* content is painted and never gates interactivity or data fetching. A user should be able to click a KPI card before its animation finishes.
- Animate **only `transform` and `opacity`.** Never animate layout properties (width/height/top/left) — they trigger reflow and drop frames.
- Keep everything at 60fps. If a screen has many moving elements, that's the signal to remove some.
- **Respect `prefers-reduced-motion`** — provide an instant (no-motion) path for every animation; gate GSAP timelines behind the media query.
- **Clean up** with `useGSAP` / `ctx.revert()` so timelines don't leak across re-renders or route changes.
- Durations: 120–200ms for feedback, ~300ms max for the one entrance. Nothing lingers.

## Component Sources

- **Base:** shadcn/ui primitives (already the foundation), themed via the tokens above.
- **21st.dev:** pull polished, animated components from the [21st.dev](https://21st.dev) community registry wherever they raise the bar — heroes, KPI/stat cards, bento grids, dashboards, sign-in screens, marquees, backgrounds/shaders, animated buttons. It's shadcn-based, so components install with `npx shadcn add "https://21st.dev/r/<author>/<component>"` and drop straight into this stack. The 21st.dev MCP server can also be connected for in-editor component generation.
- **Rule:** treat 21st.dev components as starting points, not black boxes — the code becomes yours. After installing, **re-theme every component to the tokens** (colours, radius, Outfit font, glass utility) so nothing ships with default shadcn slate/zinc styling. Consistency with the design system beats any individual flashy component.
- Don't add a component just because it's impressive — it must serve the screen it's on.

## Dashboard

The dashboard is the flagship screen — the first thing users see and the showcase for the whole look. It must feel **next-level** through layout, glass, typography, and data density — **not through heavy motion**. The measure of success is that it's genuinely useful the instant it loads. Speed is the feature; polish is the finish.

Content (all scoped to the signed-in user + their projects, permission-filtered):
- **KPI row** — glass stat cards: my open tasks, due soon / overdue, in review, completed this week. Small trend sparkline or delta vs last week.
- **My work** — a focused list of tasks assigned to me, sorted by priority/due date, with quick status change inline.
- **Activity feed** — recent activity across my projects (from ActivityLog).
- **Charts** — status distribution (donut), throughput over time (line/area), workload by assignee or project (bar). Use a charting lib that fits the stack (e.g. Recharts or a 21st.dev charts/data-viz block), themed to the tokens.
- **Board/project shortcuts** — bento-style tiles linking into each project's board.

Craft bar (in priority order):
- **Fast first.** Data renders immediately and is interactive at once. No animation gates data fetching, layout, or clicks. If a choice is between "faster" and "fancier," pick faster.
- **Server Components fetch the data; keep client JS minimal.** Fetch KPIs/aggregates on the server for fast first paint; hydrate only the pieces that truly need interactivity as `'use client'`.
- **Aggregate efficiently** — compute KPI counts with grouped DB queries, not by loading every task into memory. Cache where sensible.
- **Motion is optional garnish, not structure.** At most one quick fade/rise on first load (runs after paint, skippable, respects `prefers-reduced-motion`). No per-card stagger, no count-up that delays the real number, no re-animation on navigation back. The dashboard looks great sitting perfectly still.
- Layout is responsive bento/grid; glass on the cards, functional colours on the data, orange reserved for accents and CTAs. The "wow" comes from composition and clarity, not movement.

## Architecture & Conventions

- **Server-first.** Default to React Server Components. Add `'use client'` only when a component needs interactivity (drag-and-drop, forms, live state).
- **Mutations via Server Actions.** Prefer Server Actions over hand-rolled API route handlers for create/update/delete. Use Route Handlers (`route.ts`) only for webhooks or when an external client needs a REST endpoint.
- **Validate at the boundary.** Every Server Action and Route Handler validates input with a Zod schema before touching the DB. Never trust client input.
- **Authorisation on the server, always.** Check the user's session and role inside every Server Action / Route Handler — never rely on hiding UI as a security measure. A Viewer must not be able to mutate even if they craft the request manually.
- **Keep business logic out of components.** Put it in `lib/` or `features/<domain>/` modules that are independently testable.
- **One Zod schema per entity**, colocated with the feature, reused for form validation and server validation.

## Suggested Directory Layout

```
src/
  app/
    (auth)/           # login, register (invite token), set-password
    (dashboard)/      # authed app shell + nested routes
      projects/
      tasks/
    admin/            # admin-only: users, invites, project access (guarded)
    api/              # route handlers (webhooks only, ideally)
    layout.tsx
  components/
    ui/               # shadcn primitives
  features/           # domain logic grouped by area
    auth/
    admin/            # user management, invites, per-project access grants
    projects/
    tasks/
    comments/
    attachments/
    users/
  lib/
    db.ts             # Prisma client singleton
    auth.ts           # Auth.js config
    permissions.ts    # global + per-project access checks
    r2.ts             # R2/S3 client + presigned URL helpers
    sanitize.ts       # rich-text HTML sanitisation
  proxy.ts            # route protection (was middleware.ts)
prisma/
  schema.prisma
  migrations/
```

## Data Model (starting point)

Relational data — model it as such. Core entities and key relations:

- **User** — id, name (display name), username (unique, immutable-ish handle), email, hashedPassword (or SSO id), **globalRole** (`ADMIN` | `USER` — `ADMIN` = platform administrator; everything else is `USER`), status (`INVITED` | `ACTIVE` | `SUSPENDED`), bio (short text, optional), avatarKey (R2 object key, optional), createdAt, updatedAt. Users can edit their own name, username, bio, and avatar; only an Admin can change `globalRole` or `status`.
- **Project** — id, key (short code, e.g. "OPS"), name, description, leadId → User.
- **ProjectMembership** — id, projectId → Project, userId → User, **projectRole** (`MANAGER` | `MEMBER` | `VIEWER`), createdAt. Unique on (projectId, userId). **This is where per-project access lives** — a user sees and acts on a project only if they have a membership row (or are a global Admin). `MANAGER` can manage the project & its members; `MEMBER` can create/edit tasks; `VIEWER` is read-only.
- **Invite** — id, email, intendedGlobalRole (default `USER`), token (single-use, hashed), invitedById → User, expiresAt, acceptedAt (nullable), createdAt. Backs the invite-registration flow.
- **Task** — id, projectId → Project, key (e.g. "OPS-42"), title, description (rich text — HTML or ProseMirror JSON), type (`TASK` | `BUG` | `STORY`), status (`TODO` | `IN_PROGRESS` | `IN_REVIEW` | `DONE`), priority (`LOW` | `MEDIUM` | `HIGH` | `URGENT`), assigneeId → User, reporterId → User, parentId → Task (self-relation for subtasks), position (for board ordering), dueDate, createdAt, updatedAt.
- **Label** — id, projectId, name, colour. Many-to-many with Task.
- **Comment** — id, taskId → Task, authorId → User, body (rich text — HTML or ProseMirror JSON), createdAt.
- **Attachment** — id, taskId → Task, uploaderId → User, key (R2 object key), filename (original name), contentType (MIME), size (bytes), createdAt. The R2 object key is the storage pointer; never expose it directly — serve files via short-lived presigned download URLs.
- **AuditLog** — id, actorId → User, action, targetType, targetId, metadata (JSON), createdAt. Records admin/security-relevant events (invites sent, role grants/revokes, suspensions) separately from the per-task **ActivityLog**.
- **ActivityLog** — id, taskId → Task, actorId → User, action, oldValue, newValue, createdAt.

Notes:
- Task `position` is a sortable value (float or fractional-index) so board reordering is a single-row update, not a full re-index.
- Task `key` is generated per-project from an incrementing counter (`<PROJECT_KEY>-<n>`).
- `username` is unique (case-insensitive) — enforce with a DB unique index on the lowercased value. Validate format server-side (e.g. 3–30 chars, `[a-z0-9_]`, no leading/trailing separators) via a shared Zod schema. Reserve system handles (admin, api, support, etc.).
- Cascade deletes carefully — deleting a project should be a deliberate, Admin-only action. Deleting a task must also delete its R2 objects (see below).

## User Profiles

- Each user edits **only their own** profile (name, username, bio, avatar). Enforce ownership server-side: the session user id must match the profile being edited — a Member must not be able to edit another user's profile by crafting the request.
- **Role is not self-editable.** Changing a user's role is an Admin-only action, handled separately from profile editing, and written to an audit trail.
- **Avatars** use the same R2 flow as attachments (presigned PUT upload, private bucket, presigned GET or a small cached proxy for display). Key pattern: `avatars/<userId>/<uuid>`. Constrain to image content types, cap dimensions/size, and replace-then-delete the old object on change so avatars don't accumulate.
- Email changes (if allowed) should be treated as sensitive — out of scope for v1 unless asked; keep email tied to the auth identity.

## Onboarding & Registration

No open public sign-up. Two ways in, both admin-controlled:

1. **Invite flow.** An Admin sends an invite to an email → an `Invite` row is created with a hashed, single-use, expiring token, and an email goes out with a link (`/register?token=…`). The invitee opens the link, the server validates the token (unhashed → hash → match, not expired, not accepted), and they set their username + password (or complete SSO). On success: create the `User` (status `ACTIVE`, globalRole from the invite), mark the invite accepted, write an AuditLog entry.
2. **Admin-created account.** An Admin creates a user directly. Either set a temporary password delivered out-of-band, or generate an invite-style set-password link. Same result: an `ACTIVE` user.

Rules:
- **A newly registered user has no project access.** They can log in and edit their own profile, but see no projects until an Admin (or a project `MANAGER`) grants a `ProjectMembership`. The empty state should say so clearly ("You don't have access to any projects yet — an admin will add you").
- Invite tokens: random, hashed at rest, single-use, expiring (e.g. 72h). Validate server-side. Don't leak whether an email already exists.
- If using SSO/OIDC, still gate on an invite/allowlist so registration stays controlled — SSO authenticates, the invite authorises.
- Rate-limit registration and set-password endpoints.

## Admin Dashboard

A separate, admin-only area (`/admin`, guarded in `proxy.ts` and re-checked in every action) for managing people and access. Only users with `globalRole = ADMIN` can reach it — enforce server-side, never by hiding the nav link alone.

Capabilities:
- **Users:** list/search users; view status (`INVITED` / `ACTIVE` / `SUSPENDED`); create a user; suspend/reactivate; change `globalRole` (promote/demote Admin). Suspending must immediately block access (invalidate sessions).
- **Invites:** send an invite (email + intended global role); see pending invites; resend or revoke; expire.
- **Per-project access (the core ask):** for any project, view its members and their `projectRole`; **add a user to a project with a role** (`MANAGER` / `MEMBER` / `VIEWER`); change a member's role; remove a member. Equivalently, from a user's detail page, see and edit all their project memberships in one place. This is the screen you use to "give role-based access to users for specific projects."
- **Audit:** a readable view of the AuditLog (who invited whom, who granted/revoked which role, suspensions) for accountability.

Delegation (optional but recommended): a project `MANAGER` can manage memberships **for their own project(s)** without being a global Admin — the admin project-access UI can be reused, scoped to projects they manage. Global Admin actions (creating users, changing global roles, suspending) stay Admin-only.

Guardrails:
- Every admin mutation re-checks `globalRole = ADMIN` (or project `MANAGER` for scoped project actions) on the server, validates with a Zod schema, and writes an AuditLog entry.
- Prevent lockout: an Admin can't demote/suspend/delete the last remaining Admin.
- Don't expose password hashes, tokens, or R2 keys to the client.

## File Attachments (Cloudflare R2)

R2 is S3-compatible, so use the AWS SDK v3 S3 client pointed at the R2 endpoint. Store only metadata in Postgres (the `Attachment` row); the bytes live in R2.

**Config (env vars, never hardcode):** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and the endpoint `https://<account_id>.r2.cloudflarestorage.com`.

**Upload flow (presigned PUT — bytes never pass through the app server):**
1. Client requests an upload from a Server Action, sending filename, contentType, and size.
2. Server authorises (must be an authenticated Member+ with access to the task), validates the file against limits, generates a unique object key (e.g. `tasks/<taskId>/<uuid>/<filename>`), and returns a short-lived presigned PUT URL.
3. Client uploads the file directly to R2 via that URL.
4. On success, client calls a second Server Action to create the `Attachment` row (taskId, key, filename, contentType, size, uploaderId) and write an ActivityLog entry.

**Download/preview:** generate a short-lived presigned GET URL on demand. Keep the bucket private — no public access. Never store or render the raw R2 key as a link.

**Validation & limits (enforce server-side, in a shared Zod schema):**
- Max file size (e.g. 25 MB) — validate the claimed size before presigning AND rely on R2/content-length limits.
- Allowlist content types (images, PDFs, common docs, archives) rather than blocklisting.
- Sanitise the original filename for display; never use it to build filesystem or bucket paths directly (use the generated key).

**Lifecycle:** deleting an attachment or its parent task must delete the R2 object(s) too — do the DB delete and the R2 delete together and handle partial failure (e.g. a cleanup job for orphaned objects). Orphaned bytes cost money and leak data.

## Security Requirements

- Hash passwords with bcrypt/argon2 — never store plaintext. If using SSO, don't store passwords at all.
- All mutations require an authenticated session; check authorisation for privileged actions.
- **Two-tier authorisation — check both on the server, every time:** (1) global role (`ADMIN` vs `USER`) gates admin-area and platform actions; (2) per-project access via `ProjectMembership` gates everything inside a project. For any project-scoped action, resolve the user's `projectRole` for that specific project and confirm it permits the action (`VIEWER` read-only, `MEMBER` edit tasks, `MANAGER` manage project/members). A global Admin may bypass project checks by policy — decide explicitly and apply consistently. Centralise these checks in `lib/permissions.ts`; never trust a role sent from the client, and never rely on a hidden nav link as protection.
- Parameterised queries only (Prisma handles this — never build raw SQL from user input).
- **Sanitise rich text server-side.** Tiptap content (descriptions, comments) can carry XSS if rendered raw. Sanitise HTML on the server before persisting and/or before rendering (e.g. a strict allowlist sanitiser). Never `dangerouslySetInnerHTML` unsanitised content.
- **Attachments:** private R2 bucket, presigned URLs only, content-type allowlist, size caps — see **File Attachments**.
- Set secure headers (CSP, HSTS) and use HTTPS in production.
- Rate-limit auth endpoints.
- Since this is internal, still assume any authenticated user could be compromised — enforce least privilege by role.

## Commands

```bash
npm run dev            # start dev server (Turbopack)
npm run build          # production build
npm run start          # run production build
npm run lint           # eslint
npm run test           # vitest
npm run test:e2e       # playwright
npx prisma migrate dev # create/apply migration in dev
npx prisma studio      # inspect DB
```

## Working Agreements for Claude

- **Migrations, not auto-sync.** Any schema change goes through `prisma migrate`. Never edit the DB schema without a migration file.
- **Write the Zod schema and server-side auth check first**, then the UI. Don't ship a mutation without validation + authorisation.
- **Prefer editing existing files** over creating parallel implementations.
- **Match existing patterns** — before adding a library, check whether the stack above already covers the need.
- **Small, reviewable changes.** When implementing a feature, do the data model + migration first, then server logic, then UI, as separate steps.
- **Ask before**: adding a new dependency, changing the auth model, introducing a new top-level architectural pattern, or anything touching cascade deletes / destructive operations.
- **Tests for logic.** Add tests for permission checks, key generation, and board reordering — the parts most likely to break silently.
- When unsure about a current API (Next 16 / React 19 / Prisma / Auth.js v5), check the official docs rather than assuming — several of these have had recent breaking changes.

# Flux

Internal task & project management for one organisation — a lightweight, self-hosted "Jira for one org." Projects, tasks with subtasks and labels, a drag-and-drop Kanban board, backlog with filters, rich-text comments, R2 file attachments, invite-only onboarding, per-project roles, and an admin area with a full audit trail.

Part of the Foodverse / ICCA digital ecosystem — canonical domain `flux.foodverse.io`.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript strict · React 19 · PostgreSQL 16 + Prisma 7 · Auth.js v5 (credentials, JWT sessions) · Tailwind CSS 4 + shadcn/ui · dnd-kit · Tiptap · Cloudflare R2 (presigned uploads) · Zod + react-hook-form · Vitest + Playwright.

## Getting started

### 1. Prerequisites

- Node 20.12+ (uses `process.loadEnvFile`)
- PostgreSQL 16+. Local via Homebrew:

  ```bash
  brew install postgresql@16
  brew services start postgresql@16
  createdb flux_dev   # or: /opt/homebrew/opt/postgresql@16/bin/createdb flux_dev
  ```

  A hosted Postgres (Neon / Supabase) works too — use the pooled URL as `DATABASE_URL` and the direct URL as `DIRECT_URL`.

### 2. Environment

Copy `.env.example` to `.env.local` and fill in at minimum:

```bash
DATABASE_URL="postgresql://<you>@localhost:5432/flux_dev"
DIRECT_URL="postgresql://<you>@localhost:5432/flux_dev"
AUTH_SECRET="<openssl rand -base64 32>"
AUTH_TRUST_HOST="true"
SEED_ADMIN_PASSWORD="<a password for the seeded admin — dev only>"
```

R2 and SMTP variables are only needed for attachments/avatars and invite emails respectively; the app runs without them.

### 3. Database + seed

```bash
npm install
npx prisma migrate deploy   # apply migrations
npx prisma db seed          # admin user + demo FLUX project (10 tasks)
```

The seed prints the admin credentials (`it@iccadubai.ae` / your `SEED_ADMIN_PASSWORD`, username `admin`). It is idempotent — safe to re-run.

### 4. Run

```bash
npm run dev   # http://localhost:3000
```

## Testing

```bash
npm run test       # Vitest unit tests (permissions, schemas, position math, …)
npm run test:e2e   # Playwright e2e — needs the seeded DB (steps above)
```

The e2e suite signs in through the real login form as the seeded admin (credentials read from `.env.local`), stores the session once, and covers auth redirects, the dashboard, board + backlog views, the task drawer, task creation, and the admin area. The Playwright web server starts `npm run dev` automatically if nothing is on port 3000.

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run build          # production build
npm run start          # run production build
npm run lint           # eslint
npm run test           # vitest
npm run test:e2e       # playwright
npx prisma migrate dev # create/apply a migration in dev
npx prisma studio      # inspect the DB
npm run db:seed        # re-run the idempotent seed
```

## Project layout

```
src/
  app/            # routes: (auth) login/register, (dashboard) app shell, admin
  components/     # shadcn primitives + app shell (sidebar, topbar)
  features/       # domain logic: auth, admin, projects, tasks, comments, attachments, users, dashboard
  lib/            # db, auth, permissions, r2, sanitize, rate-limit
  proxy.ts        # edge route protection (JWT-only; real authz re-checked server-side)
prisma/           # schema, migrations, idempotent seed
e2e/              # Playwright specs (+ auth.setup.ts session bootstrap)
```

See `CLAUDE.md` for the full product spec, design system, and working agreements.

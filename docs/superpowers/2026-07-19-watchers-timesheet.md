# Timesheet — Watchers, Audit Labels, Assignee Filter

Date: 2026-07-19
Branch: `feat/watchers-audit-labels-assignee-filter` → merged to `main` (`9abeaea`), deployed to prod.

**What this measures:** subagent wall-clock time per task during subagent-driven
execution (implementer + task review + any fix/re-review rounds). Agents ran
**sequentially**, so the total ≈ cumulative elapsed build time. Excludes
brainstorming, spec/plan authoring, and controller orchestration between agents.
These are automated agent run-times, **not human-billable hours**.

| Task | Summary | Impl | Review + fix | Task total | Rounds | Commit(s) |
|------|---------|-----:|-------------:|-----------:|:------:|-----------|
| A1 | Migration: `TASK_WATCHER_ADDED` enum | 2:21 | 0:25 | **2:45** | impl + review | `91f0b25` |
| A2 | Watcher action Zod schema | 0:41 | 0:19 | **1:00** | impl + review | `94cd4cd` |
| A3 | `getTaskWatchers` query | 0:40 | 0:19 | **0:59** | impl + review | `ae91c4a` |
| A4 | `add`/`removeTaskWatcher` actions + tests | 2:14 | 6:00 | **9:14** | impl + review + fix + re-review | `62bd160`, `9bf9321` |
| A5 | Notification + activity copy | 1:11 | 0:22 | **1:33** | impl + review | `c68f02d` |
| A6 | `WatchersSection` component | 0:53 | 0:36 | **1:30** | impl + review¹ | `835c91f` |
| A7 | Slot watchers into drawer + wiring | 1:58 | 1:23 | **3:21** | impl + review | `ee1be21` |
| B1 | `buildTargetLabel` helper + test | 1:01 | 0:25 | **1:26** | impl + review | `382c6f7` |
| B2 | Batch-resolve targets in `getAuditLog` | 1:17 | 1:11 | **2:28** | impl + review | `fba4f15` |
| B3 | Render target label in `AuditTable` | 0:42 | 0:19 | **1:00** | impl + review | `b7381e4` |
| C1 | Multi-assignee `taskFilterWhere` + test | 4:11 | 1:42 | **5:53** | impl + review | `49514f1` |
| C2 | Parse repeatable assignee param | 1:16 | 1:09 | **2:25** | impl + review | `8e28393` |
| C3 | Multi-select assignee control | 3:45 | 3:11 | **6:56** | impl + review + fix | `9da881d`, `b38f730` |
| — | Final whole-branch review (cross-task) | — | 4:42 | **4:42** | opus review | — |
| — | Final hardening fix (A4 idempotency) | — | 1:39 | **1:39** | fix + test | `9abeaea` |
| | | | | **46:52** | | |

¹ A6 review flagged one "Critical" (Base UI `render=` vs Radix `asChild`) —
adjudicated a **false positive**; no rework, no added time beyond the review.

## By part
| Part | Scope | Time |
|------|-------|-----:|
| A — Watchers | A1–A7 | 20:22 |
| B — Audit labels | B1–B3 | 4:54 |
| C — Assignee filter | C1–C3 | 15:14 |
| Final review + hardening | cross-task | 6:21 |
| **Total** | | **46:52** |

## Notes
- **A4 and C3** were the heaviest — both carried review-driven fix rounds
  (A4: best-effort activity writes + notify/name test assertions; C3: dropped a
  dead `currentUserId` prop). The review loop caught real gaps, which is where
  the extra minutes went.
- **C1** had the longest single implementer run (4:11) — Vitest module-resolution
  friction (next-auth pulled in transitively) needed import-scaffold mocks.
- 13 tasks, 17 commits (incl. spec + plan), 196 tests green, deployed clean.

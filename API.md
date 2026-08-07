# Flux API Reference

Programmatic access to Flux for external agents, integrations, and scripts.

## Base URL

```
https://flux.foodverse.io/api/v1
```

All requests must be made over **HTTPS**. HTTP is not supported.

---

## Authentication

Every request requires an `Authorization` header with a bearer token:

```
Authorization: Bearer flux_sk_…
```

API keys are secrets — treat them like passwords. **Never commit keys to version control.**

### Getting an API Key

1. **Ask a Flux admin** to create a key for you at `/admin/api-keys`.
   - The key is displayed once; save it immediately.
   - Keys can be revoked at any time.

2. **Or generate a key programmatically** (admin only):
   ```bash
   node scripts/mint-api-key.mjs --email <actor-email> --name "<label>"
   ```
   - Creates an API key bound to the user's email address.
   - Label is for your reference (e.g., "GitHub Actions", "Webhook Listener").

### Key Scope

**A key is a global service credential.** A valid, non-revoked key can act on **any project** in the instance, as its actor user — not just projects that user is a member of.

**Per-project roles and memberships are NOT enforced by this API.** Endpoints validate only that the referenced project or task *exists*; they do not check the actor's `ProjectMembership` or `projectRole` (`MEMBER`, `VIEWER`, `MANAGER`) for that project. Every write is attributed to the key's actor user for audit purposes, but the key is not restricted to that user's normal web-app access.

**The actor's global role is not enforced either.** A key minted for an `EXECUTIVE` actor — a read-only, org-wide visibility role in the web app — can still create tasks, change status, and log time through this API. Only the actor's *status* is checked: the account must be `ACTIVE` (a `SUSPENDED` or still-`INVITED` actor gets `403 actor_inactive`).

This makes a key powerful: a leaked key can create tasks or log time in **every** project on the instance, regardless of the actor's actual project access or global role. Treat keys accordingly — **mint keys only through an admin**, and **revoke immediately** if a key is ever leaked or exposed.

---

## Rate Limits

- **120 requests per minute per API key**, counted on a 60-second sliding window keyed by the key's prefix.
- Requests over the limit get a `429` with a `Retry in <n>s` message; a rejected request is **not** counted toward the window, so the window drains normally.
- The limiter is **in-process and single-instance**: its state lives in server memory, resets on every restart/redeploy, and is not shared across horizontally-scaled instances. Treat the limit as abuse dampening, not a hard quota.

---

## Endpoints

### GET /projects

Fetch **all projects** on the instance. A key is a global credential — this is not filtered to projects the actor is a member of (see **Key Scope** above).

Sorted by name (A–Z). Returns at most **200** projects; there is no pagination.

**Request:**
```bash
curl -H "Authorization: Bearer flux_sk_YOUR_KEY" \
  https://flux.foodverse.io/api/v1/projects
```

**Response (200 OK):**
```json
{
  "projects": [
    {
      "id": "proj_12345",
      "key": "OPS",
      "name": "Operations"
    },
    {
      "id": "proj_67890",
      "key": "ENG",
      "name": "Engineering"
    }
  ]
}
```

---

### GET /tasks

Fetch tasks in a project, with optional filtering.

**Request:**
```bash
curl -H "Authorization: Bearer flux_sk_YOUR_KEY" \
  "https://flux.foodverse.io/api/v1/tasks?projectId=proj_12345"
```

**Query Parameters:**
- `projectId` (required): The project ID. A missing or empty value returns `400 invalid_query`; an unknown id returns `404 project_not_found`.

**Scope of results:** top-level tasks only — **subtasks are excluded**. Sorted by board `position` (ascending). Returns at most **200** tasks; there is no pagination and no status/assignee/label filtering. Filter client-side, or fetch per project.

**Response (200 OK):**
```json
{
  "tasks": [
    {
      "id": "task_111",
      "key": "OPS-42",
      "title": "Update billing logic",
      "status": "IN_PROGRESS",
      "priority": "HIGH"
    },
    {
      "id": "task_112",
      "key": "OPS-43",
      "title": "Fix dashboard crash",
      "status": "TODO",
      "priority": "URGENT"
    }
  ]
}
```

---

### POST /tasks

Create a new task in a project.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer flux_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj_12345",
    "title": "Implement OAuth",
    "type": "STORY",
    "priority": "HIGH",
    "assigneeId": "user_abc",
    "description": "Add OAuth support for SSO"
  }' \
  https://flux.foodverse.io/api/v1/tasks
```

**Request Body:**
- `projectId` (string, required): Project ID.
- `title` (string, required): Task title. Trimmed; 1–200 characters.
- `type` (string, optional): One of `TASK`, `BUG`, `STORY`. Default: `TASK`.
- `priority` (string, optional): One of `LOW`, `MEDIUM`, `HIGH`, `URGENT`. Default: `MEDIUM`.
- `assigneeId` (string, optional, nullable): User ID to assign the task to. An unknown id returns `400 assignee_not_found`.
- `description` (string, optional): Rich-text HTML, max 50,000 characters. **Sanitised server-side** before it is stored — scripts, event handlers, and disallowed tags are stripped, so what you read back may not be byte-identical to what you sent.

**Not accepted by this endpoint:** `status` (new tasks are always created as `TODO` — use `PATCH /tasks/{id}` to move one), `dueDate`, `labels`, `parentId` (subtasks), and `estimatedHours`. Set those in the web app.

**Side effects:** the task key (`<PROJECT_KEY>-<n>`) is generated from the project's counter, the **reporter is the key's actor user**, the task is positioned at the end of the project's `TODO` column, and a `created` entry is written to the task's activity log.

**Response (201 Created):**
```json
{
  "task": {
    "id": "task_999",
    "key": "OPS-99",
    "title": "Implement OAuth",
    "status": "TODO",
    "priority": "HIGH",
    "assigneeId": "user_abc"
  }
}
```

---

### PATCH /tasks/{id}

Update a task's status. Attributed to the key's actor user. Global scope — any task, including subtasks.

**Request Body:**
- `status` (string, required): One of `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`.

**Behaviour:** idempotent — sending the status the task already has returns `200` and changes nothing (no activity-log entry, no notification). A real change writes a `status_changed` activity entry and notifies the task's watchers (assignee, reporter, commenters); notification failures are swallowed and never fail the request. Status is the **only** mutable field on this endpoint — title, assignee, priority, due date, and labels are not editable via the API.

**Response (200 OK):**
```json
{
  "task": {
    "id": "task_999",
    "key": "OPS-99",
    "status": "DONE"
  }
}
```

**curl:**
```bash
curl -s -X PATCH \
  -H "Authorization: Bearer flux_sk_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"status":"DONE"}' \
  https://flux.foodverse.io/api/v1/tasks/task_999
```

Errors: `404 task_not_found` (no such task), `400 invalid_input` (unknown status value), `400 invalid_json`.

---

### POST /time

Log time spent on a task (completed work entry — **recommended for agents**).

Use this endpoint to record time safely; it does not conflict with concurrent time-tracking sessions.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer flux_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task_111",
    "minutes": 90,
    "note": "Code review and refactoring",
    "spentAt": "2026-07-19T14:30:00Z"
  }' \
  https://flux.foodverse.io/api/v1/time
```

**Request Body:**
- `taskId` (string, required): Task ID (a subtask id is fine).
- `minutes` (number, required): Whole minutes, 1–44,640 (31 days).
- `note` (string, optional): Brief note about the work, max 1,000 characters.
- `spentAt` (string, optional): ISO 8601 timestamp when time was spent. Default: now. Any `Date`-parseable string is coerced; an unparseable one returns `400 invalid_input`.

**Response (201 Created):**
```json
{
  "entry": {
    "id": "entry_555",
    "taskId": "task_111",
    "minutes": 90
  }
}
```

---

### POST /time/start

Start tracking time on a task (begins a live timer).

Only one timer can be running per actor at a time. Starting a new timer stops any existing timer for that user.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer flux_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task_111"
  }' \
  https://flux.foodverse.io/api/v1/time/start
```

**Request Body:**
- `taskId` (string, required): Task ID.

**Response (200 OK):**
```json
{
  "started": "OPS-42",
  "stoppedTaskKey": "OPS-99"
}
```

- `started`: The key of the task now being tracked.
- `stoppedTaskKey`: The key of the previously running task (if one was stopped), or `null`.

---

### POST /time/stop

Stop the currently running timer.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer flux_sk_YOUR_KEY" \
  https://flux.foodverse.io/api/v1/time/stop
```

**Response (200 OK):**
```json
{
  "stopped": true
}
```

- `stopped`: `true` if a timer was running and has been stopped; `false` if no timer was running.

---

### GET /time/running

Fetch the currently running timer (if any).

**Request:**
```bash
curl -H "Authorization: Bearer flux_sk_YOUR_KEY" \
  https://flux.foodverse.io/api/v1/time/running
```

**Response (200 OK):**
```json
{
  "running": {
    "taskId": "task_111",
    "taskKey": "OPS-42",
    "startedAt": "2026-07-19T10:00:00Z"
  }
}
```

- `running`: An object with timer details, or `null` if no timer is active.

**Response (200 OK, no active timer):**
```json
{
  "running": null
}
```

---

## Error Handling

All errors are returned as JSON with `error` and `code` fields:

```json
{
  "error": "Missing or malformed API key.",
  "code": "unauthenticated"
}
```

### Error Codes

| HTTP Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_json` | Request body is not valid JSON. |
| 400 | `invalid_input` | Body failed schema validation (Zod). |
| 400 | `invalid_query` | A required query parameter is missing or malformed (e.g. `projectId`). |
| 400 | `assignee_not_found` | `POST /tasks` was called with an `assigneeId` that doesn't exist. |
| 401 | `unauthenticated` | Missing, malformed, or unknown API key. |
| 401 | `key_revoked` | The API key has been revoked. |
| 403 | `actor_inactive` | The key's user account is not `ACTIVE` (suspended, or invited but never registered). |
| 404 | `project_not_found` | The referenced project doesn't exist. |
| 404 | `task_not_found` | The referenced task doesn't exist. |
| 429 | `rate_limited` | Request rate limit exceeded. Wait and retry. |

---

## Usage Notes

### Concurrency and Time Tracking

- The `POST /time` endpoint is **safe for concurrent use** — multiple agents can log time to the same task without conflict.
- The `POST /time/start` and `POST /time/stop` endpoints manage a single live timer per actor. If multiple systems try to manage time tracking concurrently, prefer `POST /time` to log completed work.

### Best Practices

- **Cache project and task lists locally** to reduce API calls.
- **Use long-lived API keys** for integrations; regenerate or rotate keys annually.
- **Log all API errors** with the error code for debugging.
- **Respect rate limits** — back off and retry with exponential jitter if you hit 429.
- **Never embed API keys in client-side code** — only use keys in server-side integrations.

---

## Examples

### Fetch all projects, then list tasks in the first project

```bash
BEARER_TOKEN="flux_sk_YOUR_KEY"

# Get projects
PROJECTS=$(curl -s -H "Authorization: Bearer $BEARER_TOKEN" \
  https://flux.foodverse.io/api/v1/projects)

PROJECT_ID=$(echo $PROJECTS | jq -r '.projects[0].id')

# Get tasks for the project
curl -s -H "Authorization: Bearer $BEARER_TOKEN" \
  "https://flux.foodverse.io/api/v1/tasks?projectId=$PROJECT_ID" | jq .
```

### Create a task and log time

```bash
BEARER_TOKEN="flux_sk_YOUR_KEY"

# Create a task
TASK=$(curl -s -X POST \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj_12345",
    "title": "Review PR #789",
    "type": "TASK",
    "priority": "MEDIUM"
  }' \
  https://flux.foodverse.io/api/v1/tasks)

TASK_ID=$(echo $TASK | jq -r '.task.id')

# Log time
curl -s -X POST \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "minutes": 45,
    "note": "Code review completed"
  }' \
  https://flux.foodverse.io/api/v1/time | jq .
```

### Start and stop a timer

```bash
BEARER_TOKEN="flux_sk_YOUR_KEY"

# Start timer on task
curl -s -X POST \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "task_111"}' \
  https://flux.foodverse.io/api/v1/time/start

# ... do work ...

# Stop timer
curl -s -X POST \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  https://flux.foodverse.io/api/v1/time/stop
```

---

## Other HTTP Endpoints

These are **not** part of the `/api/v1` key-authenticated surface — they do not accept `flux_sk_…` bearer tokens — but they are the only other HTTP routes Flux exposes, listed here so integrators know they exist.

### GET /api/files/{attachmentId}

Serves an attachment or inline comment image. Authenticated by the **browser session cookie**, not an API key; the caller must hold at least `VIEWER` on the attachment's project. Responds `302` to a short-lived presigned R2 URL — bytes never pass through the app server and the R2 object key is never exposed.

- `?download=1` forces `Content-Disposition: attachment`; the default is inline so images render in comment bodies.
- SVG and HTML attachments are **always** forced to download regardless of the flag — both can carry `<script>`, and serving them inline would let anyone who can attach a file host a live page on the Flux origin.
- Errors: `401` (no session), `403` (no project access), `404` (unknown or malformed id).

### GET|POST /api/cron/due-reminders

Cron-triggered due-date reminder digest plus orphan draft-attachment sweep. Auth is a **shared secret only** — `CRON_SECRET` must be set and match either `Authorization: Bearer <secret>` or an `x-cron-secret` header (compared in constant time). If `CRON_SECRET` is unset the job never runs. Stateless: it keeps no "already reminded" record, so hit it at most once a day.

---

## Support

For API issues or requests, contact the Flux admin team or file an issue in the project.

**Last updated:** 2026-08-07

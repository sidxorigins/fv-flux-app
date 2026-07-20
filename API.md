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

A key grants access as a specific user across **all projects** that user has access to. The actor's per-project roles (`MEMBER`, `VIEWER`, `MANAGER`) are enforced — a key cannot bypass role restrictions.

---

## Rate Limits

- **Per-instance limit**: 120 requests per minute (per API key).
- **Per-request limit**: Requests that exceed per-project rate limits receive a 429 response.
- Rate limit resets on a 60-second sliding window.

---

## Endpoints

### GET /projects

Fetch all projects the authenticated user can access.

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
- `projectId` (required): The project ID.

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
- `title` (string, required): Task title.
- `type` (string, optional): One of `TASK`, `BUG`, `STORY`. Default: `TASK`.
- `priority` (string, optional): One of `LOW`, `MEDIUM`, `HIGH`, `URGENT`. Default: `MEDIUM`.
- `assigneeId` (string, optional): User ID to assign the task to.
- `description` (string, optional): Rich-text description (HTML or ProseMirror JSON).

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
- `taskId` (string, required): Task ID.
- `minutes` (number, required): Duration in minutes (1–44640).
- `note` (string, optional): Brief note about the work.
- `spentAt` (string, optional): ISO 8601 timestamp when time was spent. Default: now.

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
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

### Error Codes

| HTTP Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed request (invalid JSON, missing required field, or invalid input). |
| 401 | `UNAUTHORIZED` | Missing, invalid, or revoked API key. |
| 403 | `FORBIDDEN` | Authenticated user is inactive (suspended) or lacks permission for the requested resource. |
| 404 | `NOT_FOUND` | Resource not found (project, task, or user). |
| 429 | `RATE_LIMITED` | Request rate limit exceeded. Wait and retry. |
| 500 | `INTERNAL_ERROR` | Unexpected server error. Contact support if it persists. |

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

## Support

For API issues or requests, contact the Flux admin team or file an issue in the project.

**Last updated:** 2026-07-20

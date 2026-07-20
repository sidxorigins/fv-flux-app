"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  PROJECT_ROLE_ORDER,
  requireProjectRole,
  requireUser,
} from "@/lib/permissions";
import {
  startTimerSchema,
  updateTimeEntrySchema,
  deleteTimeEntrySchema,
  type StartTimerInput,
  type UpdateTimeEntryInput,
  type DeleteTimeEntryInput,
} from "./schemas";
import { startTimerForUser, stopTimerForUser } from "./service";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function mapAuthError(err: unknown): { ok: false; error: string } | null {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return fail("You must be signed in.");
      case "SUSPENDED":
        return fail("Your account is suspended.");
      case "FORBIDDEN":
        return fail("You don't have permission to do that.");
    }
  }
  return null;
}

/**
 * Start a timer on a task (MEMBER+). One running timer per user: any existing
 * running timer is auto-closed first (in the same tx), and its task key is
 * returned so the UI can say "Stopped timer on OPS-9".
 */
export async function startTimer(
  input: StartTimerInput,
): Promise<ActionResult<{ startedTaskKey: string; stoppedTaskKey: string | null }>> {
  const parsed = startTimerSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const task = await prisma.task.findUnique({
      where: { id: parsed.data.taskId },
      select: { projectId: true, key: true },
    });
    if (!task) return fail("Task not found.");
    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    const { stoppedTaskKey } = await startTimerForUser(user.id, parsed.data.taskId);

    revalidatePath(`/projects/${task.projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true, data: { startedTaskKey: task.key, stoppedTaskKey } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Stop the signed-in user's running timer (no-op if none). */
export async function stopTimer(): Promise<ActionResult<{ stopped: boolean }>> {
  try {
    const user = await requireUser();
    const { stopped, projectId } = await stopTimerForUser(user.id);
    if (!stopped) return { ok: true, data: { stopped: false } };
    if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true, data: { stopped: true } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

type TimeEntryForManage = {
  id: string;
  userId: string;
  endedAt: Date | null;
  task: { projectId: string };
};

type AuthorizeManageResult =
  | { ok: true; entry: TimeEntryForManage }
  | { ok: false; error: { ok: false; error: string } };

/**
 * Load an entry + authorise the caller to manage it (owner MEMBER+, or MANAGER/Admin).
 * Returns an `ok`-discriminated union (not an ad-hoc `"key" in auth` shape) — TS's
 * `in` narrowing doesn't reliably exclude a branch where the key is merely typed
 * `undefined` rather than absent, so a real discriminant is required here.
 */
async function authorizeManage(entryId: string): Promise<AuthorizeManageResult> {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true, endedAt: true, task: { select: { projectId: true } } },
  });
  if (!entry) return { ok: false, error: fail("Time entry not found.") };
  const { user, role } = await requireProjectRole(entry.task.projectId, "MEMBER");
  const isOwner = entry.userId === user.id;
  const isManager = PROJECT_ROLE_ORDER[role] >= PROJECT_ROLE_ORDER.MANAGER;
  if (!isOwner && !isManager) {
    return { ok: false, error: fail("You don't have permission to do that.") };
  }
  return { ok: true, entry };
}

/** Edit a completed entry's minutes (owner or MANAGER/Admin). */
export async function updateTimeEntry(input: UpdateTimeEntryInput): Promise<ActionResult> {
  const parsed = updateTimeEntrySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const auth = await authorizeManage(parsed.data.id);
    if (!auth.ok) return auth.error;
    if (!auth.entry.endedAt) return fail("Stop the timer before editing it.");
    await prisma.timeEntry.update({
      where: { id: parsed.data.id },
      data: { minutes: parsed.data.minutes },
    });
    revalidatePath(`/projects/${auth.entry.task.projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Delete an entry (owner or MANAGER/Admin). */
export async function deleteTimeEntry(input: DeleteTimeEntryInput): Promise<ActionResult> {
  const parsed = deleteTimeEntrySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const auth = await authorizeManage(parsed.data.id);
    if (!auth.ok) return auth.error;
    await prisma.timeEntry.delete({ where: { id: parsed.data.id } });
    revalidatePath(`/projects/${auth.entry.task.projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

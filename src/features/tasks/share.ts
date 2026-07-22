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

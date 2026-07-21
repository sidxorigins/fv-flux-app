/**
 * Absolute permalink for a task — the existing permission-gated deep link
 * (`/projects/<projectId>?task=<taskId>`) the app already routes on. Pure so it
 * is unit-testable; callers pass `window.location.origin` (client-only) as `origin`
 * so the copied link matches the host the user is actually on.
 */
export function taskShareUrl(
  origin: string,
  projectId: string,
  taskId: string,
): string {
  return `${origin}/projects/${projectId}?task=${taskId}`;
}

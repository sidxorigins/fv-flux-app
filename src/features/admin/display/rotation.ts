// Pure rotation-setting helpers. Deliberately NOT a "server-only" module and
// deliberately no DB access, so the client control, the /display route and the
// unit tests can all import it — same convention as features/tasks/format.ts.

export const ROTATION_KEY = "wallBoard.rotationSeconds";

export const DEFAULT_ROTATION_SECONDS = 60;

/** Bounds shared by the action, the UI and the read path, so a value that
 * round-trips through the database can never fall outside what the rotator
 * accepts. Below ~5s the board strobes; above ~5min it reads as frozen. */
export const MIN_ROTATION_SECONDS = 5;
export const MAX_ROTATION_SECONDS = 300;

export function clampRotationSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROTATION_SECONDS;
  return Math.min(
    Math.max(Math.round(value), MIN_ROTATION_SECONDS),
    MAX_ROTATION_SECONDS,
  );
}

import "server-only";

import { prisma } from "@/lib/db";
import { DEFAULT_ROTATION_SECONDS, ROTATION_KEY, clampRotationSeconds } from "./rotation";

// DB read for the wall-board settings. The pure helpers live in ./rotation so
// the client control and the tests can share them without dragging server-only
// into a client bundle.

/**
 * How long each pane holds. Falls back to the default when unset or when the
 * stored value is unparseable — a corrupt row must not leave the office wall
 * stuck on one screen.
 */
export async function getRotationSeconds(): Promise<number> {
  const row = await prisma.appSetting.findUnique({
    where: { key: ROTATION_KEY },
    select: { value: true },
  });
  if (!row) return DEFAULT_ROTATION_SECONDS;
  return clampRotationSeconds(Number(row.value));
}

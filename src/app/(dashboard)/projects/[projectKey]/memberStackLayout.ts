// Geometry for the project-header member stack (MemberFilterStack).
//
// Chips are absolutely positioned and placed purely with `transform:
// translateX`, so blooming the stack open animates nothing that reflows
// (CLAUDE.md: transform/opacity only). Kept out of the "use client" component
// so the arithmetic is unit-testable without pulling in next/navigation.

/** Avatar diameter — must track the `size-6` on AssigneeAvatar. */
export const AVATAR = 24;
/** Collapsed spacing: 8px of overlap, matching the old `-space-x-2` look. */
export const COLLAPSED_STEP = 16;
/** Expanded spacing: 6px of clear air between faces. */
export const EXPANDED_STEP = 30;

/** Width of the collapsed row — the container keeps this width in both states. */
export function collapsedWidth(chipCount: number): number {
  if (chipCount <= 0) return 0;
  return AVATAR + (chipCount - 1) * COLLAPSED_STEP;
}

/** Width the row occupies once expanded (always >= collapsedWidth). */
export function expandedWidth(chipCount: number): number {
  if (chipCount <= 0) return 0;
  return AVATAR + (chipCount - 1) * EXPANDED_STEP;
}

/**
 * translateX for chip `index`, in px.
 *
 * Expanded, the row is shifted left by the extra width it gains, which pins
 * its RIGHT edge in place — the stack blooms leftward into the header's
 * flexible gap instead of shoving the Labels / Members / settings controls
 * sideways. Offsets may go negative while expanded; that is the point.
 */
export function chipOffset(
  index: number,
  expanded: boolean,
  chipCount: number,
): number {
  if (!expanded) return index * COLLAPSED_STEP;
  const shift = expandedWidth(chipCount) - collapsedWidth(chipCount);
  return index * EXPANDED_STEP - shift;
}

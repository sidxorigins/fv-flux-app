// Fractional-index board ordering — pure math, no I/O, so it is unit-testable in
// isolation (tests land in a later phase). A task's `position` is a float; cards in
// a column are ordered ascending (smallest = top). Inserting between two cards uses
// the midpoint of their positions, so a normal move is a single-row update. When two
// neighbours get too close to bisect (float precision exhausted), the caller
// re-spaces the whole column with `rebalancedPositions` and then re-inserts.

/** Gap between freshly-spaced cards. Large enough for many bisections before rebalance. */
export const POSITION_STEP = 1024;

/**
 * Smallest gap we will still bisect. Below this, `(before + after) / 2` can equal an
 * endpoint in float arithmetic, which would collide — so we rebalance instead.
 */
export const MIN_POSITION_GAP = 1e-6;

/**
 * Position for a card dropped between `before` and `after` — the current positions of
 * the cards immediately above / below the drop point, or null at a column edge.
 *   - between two cards → their midpoint
 *   - at the bottom (only a card above) → above + STEP
 *   - at the top (only a card below) → below / 2  (stays > 0, leaves room above)
 *   - empty column (neither) → STEP
 */
export function computeMidpoint(
  before: number | null,
  after: number | null,
): number {
  if (before !== null && after !== null) return (before + after) / 2;
  if (before !== null) return before + POSITION_STEP;
  if (after !== null) return after / 2;
  return POSITION_STEP;
}

/**
 * True when `before`/`after` are too close to bisect safely and the destination
 * column must be re-spaced first. Only meaningful when inserting *between* two cards;
 * an open-ended insert (either side null) never needs a rebalance.
 */
export function needsRebalance(
  before: number | null,
  after: number | null,
): boolean {
  if (before === null || after === null) return false;
  return Math.abs(after - before) < MIN_POSITION_GAP;
}

/**
 * Evenly-spaced positions (STEP, 2·STEP, …) for `count` cards after a rebalance —
 * the i-th card in the re-ordered column gets `(i + 1) * STEP`.
 */
export function rebalancedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_STEP);
}

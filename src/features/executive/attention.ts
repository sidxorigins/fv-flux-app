// The "needs attention" item shape and its ranking rule. Pure and
// Prisma-free, so both the server query and a client component can import it,
// and so the ranking is unit-testable without a database.

export type AttentionKind = "OVERDUE" | "STUCK_IN_REVIEW" | "UNOWNED_URGENT";

export interface AttentionItem {
  id: string;
  taskKey: string;
  projectId: string;
  projectKey: string;
  title: string;
  kind: AttentionKind;
  /**
   * Days overdue (OVERDUE), days sitting in review (STUCK_IN_REVIEW), or days
   * since creation (UNOWNED_URGENT). Always a real elapsed-day count — never a
   * placeholder — so it is safe to both display and sort on.
   */
  ageDays: number;
  assigneeName: string | null;
  canOpen: boolean;
}

/** How many rows the list shows in total. */
export const ATTENTION_CAP = 15;

/**
 * Slots each kind is guaranteed before the higher-precedence kinds take the
 * remainder. This is what stops a large overdue backlog from rendering the
 * other categories invisible.
 */
export const KIND_RESERVE = 3;

/** OVERDUE beats STUCK_IN_REVIEW beats UNOWNED_URGENT. */
export const KIND_ORDER: Record<AttentionKind, number> = {
  OVERDUE: 0,
  STUCK_IN_REVIEW: 1,
  UNOWNED_URGENT: 2,
};

const KINDS = ["OVERDUE", "STUCK_IN_REVIEW", "UNOWNED_URGENT"] as const;

/**
 * Rank and truncate the attention list.
 *
 * 1. De-duplicate by task id, keeping the highest-precedence kind — a task can
 *    qualify under several rules but must appear once.
 * 2. Reserve up to KIND_RESERVE slots for each kind that has candidates, so
 *    every live category is visible.
 * 3. Fill the remaining slots in precedence order, oldest first.
 * 4. Sort the result by precedence, then by age descending.
 */
export function rankAttention(
  candidates: AttentionItem[],
  cap: number = ATTENTION_CAP,
): AttentionItem[] {
  const byId = new Map<string, AttentionItem>();
  for (const c of candidates) {
    const existing = byId.get(c.id);
    if (!existing || KIND_ORDER[c.kind] < KIND_ORDER[existing.kind]) {
      byId.set(c.id, c);
    }
  }

  // Per-kind queues, oldest first — the order slots are handed out in.
  const queues = new Map<AttentionKind, AttentionItem[]>(
    KINDS.map((kind) => [
      kind,
      [...byId.values()]
        .filter((i) => i.kind === kind)
        .sort((a, b) => b.ageDays - a.ageDays),
    ]),
  );

  const picked: AttentionItem[] = [];
  const taken = new Map<AttentionKind, number>(KINDS.map((k) => [k, 0]));

  // Pass 1 — reservation, so no live kind can be crowded out.
  for (const kind of KINDS) {
    const queue = queues.get(kind)!;
    const n = Math.min(KIND_RESERVE, queue.length, cap - picked.length);
    picked.push(...queue.slice(0, n));
    taken.set(kind, n);
  }

  // Pass 2 — remaining slots go to the higher-precedence kinds first.
  for (const kind of KINDS) {
    if (picked.length >= cap) break;
    const queue = queues.get(kind)!;
    const from = taken.get(kind)!;
    picked.push(...queue.slice(from, from + (cap - picked.length)));
  }

  return picked.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.ageDays - a.ageDays,
  );
}

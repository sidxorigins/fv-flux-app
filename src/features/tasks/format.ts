// Pure, framework-agnostic task formatting helpers. Deliberately NOT a
// "use client" module so both Server Components (e.g. the /explore results
// table, email rendering) and Client Components can import it — a function
// exported from a "use client" file cannot be called during server render.

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** Deterministic (locale-independent) date label — safe for SSR hydration and server render. */
export function formatDueDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

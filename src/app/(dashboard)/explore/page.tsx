import { getExploreFilterOptions, getExploreTasks } from "@/features/explore/queries"
import { parseExploreFilters } from "@/features/explore/schemas"
import { listSavedFilters } from "@/features/explore/saved-filter-actions"
import { ExploreFilterBar } from "@/features/explore/components/ExploreFilterBar"
import { ExploreResults } from "@/features/explore/components/ExploreResults"

interface ExplorePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Mirrors the manager dashboard's guard-empty-scope pattern (see /manager). */
function EmptyState() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Explore
      </h1>
      <div className="glass mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-2 px-8 py-12 text-center">
        <p className="text-base font-medium text-foreground">
          You don&apos;t have access to any projects yet
        </p>
        <p className="text-sm text-muted-foreground">
          An admin will add you to a project — once you do, this page lets you
          search and filter every task you can see, across projects.
        </p>
      </div>
    </div>
  )
}

/**
 * The Task Explorer — a permission-scoped, cross-project search over every
 * task the signed-in user can access. RSC: reads `searchParams`, fetches on
 * the server, and hands the client filter bar its options + the current
 * saved filters. The three data sources are independent reads (options don't
 * depend on the current page of tasks, saved filters don't depend on either),
 * so they run in one `Promise.all` — each of getExploreFilterOptions /
 * getExploreTasks already short-circuits cheaply when the caller has no
 * accessible projects (see features/explore/queries.ts), so it's safe to
 * always fetch all three and decide the empty-state branch afterward.
 */
export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const sp = await searchParams
  const filters = parseExploreFilters(sp)
  const page = Number(sp.page ?? 1)

  const [options, tasksPage, savedFiltersResult] = await Promise.all([
    getExploreFilterOptions(),
    getExploreTasks(filters, page),
    listSavedFilters(),
  ])

  // getExploreFilterOptions() returns an empty `projects` list exactly when
  // resolveAccessibleProjectIds() resolved to zero ids — the same "empty
  // accessible set" signal the query layer itself guards against.
  if (options.projects.length === 0) {
    return <EmptyState />
  }

  const savedFilters = savedFiltersResult.ok ? (savedFiltersResult.data ?? []) : []

  // Carries every current filter param (minus `page`) forward into the
  // pagination links — array-aware so a repeated param is never dropped.
  const baseParams = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (key === "page") continue
    if (Array.isArray(value)) {
      for (const v of value) baseParams.append(key, v)
    } else if (value) {
      baseParams.set(key, value)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Explore
        </h1>
        <p className="text-sm text-muted-foreground">
          Search and filter every task you have access to, across projects.
        </p>
      </div>

      <ExploreFilterBar options={options} savedFilters={savedFilters} />

      <ExploreResults data={tasksPage} baseQuery={baseParams.toString()} />
    </div>
  )
}

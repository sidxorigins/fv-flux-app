"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FolderKanban, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  searchTasksAndProjects,
} from "@/features/tasks/actions"
import type { SearchResults } from "@/features/tasks/queries"
import { StatusBadge } from "@/features/tasks/components/StatusBadge"
import { TypeIcon } from "@/features/tasks/components/TypeIcon"

const EMPTY: SearchResults = { tasks: [], projects: [] }

/**
 * Global ⌘K command palette. Opens from the topbar Search button or the
 * ⌘K / Ctrl-K shortcut. Live cross-project search (server-side, permission
 * -scoped) for tasks and projects; selecting one navigates there. cmdk's own
 * filtering is disabled — the server already ranked the results.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchResults>(EMPTY)
  const [isPending, startTransition] = React.useTransition()

  // ⌘K / Ctrl-K toggles the palette.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // Debounced server search as the query changes. All setState happens inside
  // the timeout (never synchronously in the effect body).
  React.useEffect(() => {
    const q = query.trim()
    const handle = setTimeout(() => {
      if (q.length === 0) {
        setResults(EMPTY)
        return
      }
      startTransition(async () => {
        setResults(await searchTasksAndProjects(q))
      })
    }, 180)
    return () => clearTimeout(handle)
  }, [query])

  function go(href: string) {
    setOpen(false)
    setQuery("")
    setResults(EMPTY)
    router.push(href)
  }

  const hasResults =
    results.tasks.length > 0 || results.projects.length > 0

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground hover:text-foreground"
      >
        <Search aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search tasks and projects"
      >
        {/* Server ranks the results, so cmdk's own fuzzy filter is off. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search tasks and projects…"
          />
          <CommandList>
          {query.trim().length === 0 ? (
            <CommandEmpty>Type to search tasks and projects.</CommandEmpty>
          ) : !hasResults && !isPending ? (
            <CommandEmpty>No matches.</CommandEmpty>
          ) : null}

          {results.projects.length > 0 ? (
            <CommandGroup heading="Projects">
              {results.projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project-${project.id}`}
                  onSelect={() => go(`/projects/${project.id}`)}
                >
                  <FolderKanban aria-hidden />
                  <span className="font-mono text-xs text-muted-foreground">
                    {project.key}
                  </span>
                  <span className="truncate">{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results.tasks.length > 0 ? (
            <CommandGroup heading="Tasks">
              {results.tasks.map((task) => (
                <CommandItem
                  key={task.id}
                  value={`task-${task.id}`}
                  onSelect={() =>
                    go(`/projects/${task.projectId}?task=${task.id}`)
                  }
                >
                  <TypeIcon type={task.type} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {task.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  <StatusBadge status={task.status} />
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

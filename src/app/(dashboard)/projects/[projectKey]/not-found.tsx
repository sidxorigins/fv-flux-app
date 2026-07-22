import Link from "next/link"
import { FolderX } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Covers both a genuinely missing project id AND "no access" — the page
 * deliberately treats FORBIDDEN the same as not-found rather than a 403, so
 * an unauthorised user can't tell the difference between "doesn't exist" and
 * "exists but you can't see it".
 */
export default function ProjectNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <FolderX aria-hidden className="size-8 text-muted-foreground" />
      <h1 className="text-lg font-medium text-foreground">
        Project not found
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        It may have been deleted, or you don&apos;t have access to it.
      </p>
      <Button render={<Link href="/projects" />}>Back to projects</Button>
    </div>
  )
}

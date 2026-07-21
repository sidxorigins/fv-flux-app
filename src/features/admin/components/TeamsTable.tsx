import Link from "next/link";
import { FolderKanban, Users } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { AdminTeamRow } from "../queries";
import { TeamStatusBadge } from "./display";

interface TeamsTableProps {
  teams: AdminTeamRow[];
}

/** The teams list — mirrors `UsersTable`'s styling (see CLAUDE.md admin dashboard patterns). */
export function TeamsTable({ teams }: TeamsTableProps) {
  if (teams.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No teams yet. Create one to start grouping users and granting project
        access in bulk.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Team</TableHead>
            <TableHead>Manager</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Projects</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teams.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link
                  href={`/admin/teams/${t.id}`}
                  className="font-medium text-foreground outline-none hover:underline focus-visible:underline"
                >
                  {t.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {t.managerName ?? <span className="italic">Unassigned</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5" aria-hidden />
                  {t.memberCount}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <FolderKanban className="size-3.5" aria-hidden />
                  {t.projectCount}
                </span>
              </TableCell>
              <TableCell>
                <TeamStatusBadge isActive={t.isActive} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { AdminAuditRow } from "../queries";

function hasMetadata(metadata: unknown): boolean {
  return (
    metadata !== null &&
    metadata !== undefined &&
    !(typeof metadata === "object" && Object.keys(metadata as object).length === 0)
  );
}

export function AuditTable({ rows }: { rows: AdminAuditRow[] }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No audit entries match this filter.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8" />
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isOpen = expanded.has(r.id);
            const canExpand = hasMetadata(r.metadata);
            return (
              <React.Fragment key={r.id}>
                <TableRow
                  className={cn(canExpand && "cursor-pointer")}
                  onClick={canExpand ? () => toggle(r.id) : undefined}
                  aria-expanded={canExpand ? isOpen : undefined}
                >
                  <TableCell>
                    {canExpand ? (
                      <ChevronRight
                        className={cn(
                          "size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                          isOpen && "rotate-90",
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {r.createdAtLabel}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-foreground">{r.actorName}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      @{r.actorUsername}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{r.action}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">{r.targetType}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{r.targetId}</span>
                  </TableCell>
                </TableRow>
                {canExpand && isOpen ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="whitespace-normal p-0">
                      <pre className="overflow-x-auto bg-surface-raised px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// Pure resolution of an AuditLog (targetType, targetId) to a human label.
// The Maps are populated by getAuditLog via batched queries; this file has no
// DB access so it stays trivially unit-testable.

export interface AuditTargetLookups {
  users: Map<string, { name: string; username: string }>;
  projects: Map<string, { key: string; name: string }>;
  tasks: Map<string, { key: string }>;
  invites: Map<string, { email: string }>;
  memberships: Map<
    string,
    { userName: string; username: string; projectKey: string }
  >;
}

/** Human label for an audit target, or the raw id when it can't be resolved. */
export function buildTargetLabel(
  targetType: string,
  targetId: string,
  l: AuditTargetLookups,
): string {
  switch (targetType) {
    case "User": {
      const u = l.users.get(targetId);
      return u ? `${u.name} @${u.username}` : targetId;
    }
    case "Project": {
      const p = l.projects.get(targetId);
      return p ? `${p.key} — ${p.name}` : targetId;
    }
    case "Task": {
      const t = l.tasks.get(targetId);
      return t ? t.key : targetId;
    }
    case "Invite": {
      const i = l.invites.get(targetId);
      return i ? i.email : targetId;
    }
    case "ProjectMembership": {
      const m = l.memberships.get(targetId);
      return m ? `${m.userName} @${m.username} · ${m.projectKey}` : targetId;
    }
    default:
      return targetId;
  }
}

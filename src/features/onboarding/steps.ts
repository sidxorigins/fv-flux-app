export interface TourStep {
  target: string | null; // CSS selector; null = centered (welcome/finish)
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
}

/** The dashboard overview tour. Admin step is included only for admins. */
export function dashboardTourSteps(isAdmin: boolean): TourStep[] {
  return [
    { target: null, title: "Welcome to Flux", body: "A quick tour of the essentials — takes about a minute. You can skip anytime." },
    { target: '[data-tour="nav-dashboard"]', title: "Dashboard", body: "Your home base: KPIs, your work, and recent activity.", placement: "right" },
    { target: '[data-tour="nav-inbox"]', title: "Inbox", body: "Notifications land here — mentions, task assignments, and comments.", placement: "right" },
    { target: '[data-tour="nav-projects"]', title: "Projects", body: "Each project has a Kanban board, a backlog, and time reports.", placement: "right" },
    { target: '[data-tour="nav-tasks"]', title: "My Tasks", body: "Every task assigned to you, in one focused list.", placement: "right" },
    ...(isAdmin
      ? [{ target: '[data-tour="nav-admin"]', title: "Admin", body: "Manage users, invites, per-project access, and API keys.", placement: "right" as const }]
      : []),
    { target: '[data-tour="dashboard-kpis"]', title: "Your KPIs", body: "At a glance: open tasks, due soon, in review, and completed this week.", placement: "bottom" },
    { target: '[data-tour="dashboard-mywork"]', title: "My work", body: "Your tasks by priority and due date — change status inline, no page load.", placement: "top" },
    { target: '[data-tour="create-task"]', title: "Create a task", body: "Spin up a task anytime from here.", placement: "bottom" },
    { target: null, title: "You're set", body: "That's the tour. Replay anytime from “Take a tour” in the top bar." },
  ];
}

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps {
  children: React.ReactNode;
  /** Page-context content rendered on the left side of the topbar. */
  topbarContent?: React.ReactNode;
}

/**
 * Authed app shell — glass sidebar + glass topbar over the gradient backdrop.
 * Server component: the only client surface underneath is the nav's active
 * state (NavLinks).
 */
export function AppShell({ children, topbarContent }: AppShellProps) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar>{topbarContent}</Topbar>
        <main className="flex-1 px-4 pt-6 pb-10 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

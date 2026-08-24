import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LogoutButton } from "@/app/workspace/logout-button";
import { BrandLockup } from "@/components/brand-lockup";
import { WorkbenchSidebarLoader } from "@/components/features/workbench-sidebar";
import { BackButton } from "@/components/navigation/back-button";

/**
 * Keeps workbench-originated tools inside the writing context.
 * The ordinary AppShell remains the default for global navigation.
 */
export async function WorkspaceToolShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/api/v1/auth/logout");
  }

  return (
    <div data-shell="workbench-tool" className="mz-workspace-tool-shell">
      <header className="mz-workspace-tool-header">
        <div className="flex min-w-0 items-center gap-3">
          <BackButton />
          <BrandLockup href="/workspace" ariaLabel="返回墨舟创作台" compact />
          <span aria-hidden className="hidden h-4 w-px bg-surface-2 sm:block" />
          <span className="flex items-center gap-1.5 text-sm text-zinc-300">
            <span aria-hidden className="inline-block size-1.5 rounded-full bg-accent" />
            创作台
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-56 truncate text-xs text-faint sm:inline" title={user.email}>
            {user.email}
          </span>
          <LogoutButton />
        </div>
      </header>

      <div className="mz-workspace-tool-layout">
        <WorkbenchSidebarLoader />
        <div className="mz-workspace-tool-main">{children}</div>
      </div>
    </div>
  );
}

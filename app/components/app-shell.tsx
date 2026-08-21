import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AppShellNav } from "@/components/app-shell-nav";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/api/v1/auth/logout");
  }

  return (
    <div className="mz-app-shell">
      <AppShellNav userEmail={user.email} />
      <div className="mz-app-content">{children}</div>
    </div>
  );
}

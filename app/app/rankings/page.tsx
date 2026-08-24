import { AppShell } from "@/components/app-shell";
import { RankingsView } from "@/components/features/rankings-view";
import { WorkspaceToolShell } from "@/components/workspace-tool-shell";

export default async function RankingsViewPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string | string[] }>;
}) {
  const params = await searchParams;
  const content = <RankingsView />;

  return params.surface === "workbench" ? (
    <WorkspaceToolShell>{content}</WorkspaceToolShell>
  ) : (
    <AppShell>{content}</AppShell>
  );
}

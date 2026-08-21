import { AppShell } from "@/components/app-shell";
import { SkillsView } from "@/components/features/skills-view";
import { WorkspaceToolShell } from "@/components/workspace-tool-shell";

export default async function SkillsViewPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string | string[] }>;
}) {
  const params = await searchParams;
  const content = <SkillsView />;

  return params.surface === "workbench" ? (
    <WorkspaceToolShell>{content}</WorkspaceToolShell>
  ) : (
    <AppShell>{content}</AppShell>
  );
}

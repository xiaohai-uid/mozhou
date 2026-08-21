import { AppShell } from "@/components/app-shell";
import { DeconstructView } from "@/components/features/deconstruct-view";
import { WorkspaceToolShell } from "@/components/workspace-tool-shell";

export default async function DeconstructPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string | string[] }>;
}) {
  const params = await searchParams;
  const content = <DeconstructView />;

  return params.surface === "workbench" ? (
    <WorkspaceToolShell>{content}</WorkspaceToolShell>
  ) : (
    <AppShell>{content}</AppShell>
  );
}

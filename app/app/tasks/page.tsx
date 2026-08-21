import { AppShell } from "@/components/app-shell";
import { TaskCenterView } from "@/components/features/task-center-view";
import { WorkspaceToolShell } from "@/components/workspace-tool-shell";

/** 任务中心（票 09 折回：B 看板三列 + C 驾驶舱详情，2026-08-17 定案）。 */
export default async function TaskCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string | string[] }>;
}) {
  const params = await searchParams;
  const content = <TaskCenterView />;

  return params.surface === "workbench" ? (
    <WorkspaceToolShell>{content}</WorkspaceToolShell>
  ) : (
    <AppShell>{content}</AppShell>
  );
}

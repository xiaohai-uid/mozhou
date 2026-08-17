import { AppShell } from "@/components/app-shell";
import { TaskCenterView } from "@/components/features/task-center-view";

/** 任务中心（票 09 折回：B 看板三列 + C 驾驶舱详情，2026-08-17 定案）。 */
export default function TaskCenterPage() {
  return (
    <AppShell>
      <TaskCenterView />
    </AppShell>
  );
}

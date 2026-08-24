import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { WorkbenchView } from "@/components/features/workbench-view";

/** 创作台（A 版双栏写作台，工单 07）：登录后统一工作入口。 */
export default async function WorkspacePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/api/v1/auth/logout");
  }
  return <WorkbenchView userEmail={user.email} />;
}

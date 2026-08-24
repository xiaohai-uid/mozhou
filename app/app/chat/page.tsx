import { AppShell } from "@/components/app-shell";
import { ChatView } from "./chat-view";
import { WorkspaceToolShell } from "@/components/workspace-tool-shell";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string | string[] }>;
}) {
  const params = await searchParams;
  const content = <ChatView />;

  return params.surface === "workbench" ? (
    <WorkspaceToolShell>{content}</WorkspaceToolShell>
  ) : (
    <AppShell>{content}</AppShell>
  );
}

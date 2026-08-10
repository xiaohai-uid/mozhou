import { AppShell } from "@/components/app-shell";
import { ChapterEditorView } from "@/components/features/chapter-editor-view";

// 章节编辑器（V1.1 Journey ⑦ Mock Preview）：chapterId 为 URL 语义占位，
// 当前阶段全前端 Mock（本地假数据 + 定时器），UI Frozen 后 progressive swap 接真实数据。
export default function ChapterPage() {
  return (
    <AppShell>
      <ChapterEditorView />
    </AppShell>
  );
}

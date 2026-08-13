import { AppShell } from "@/components/app-shell";
import { ChapterEditorView } from "@/components/features/chapter-editor-view";

// 章节编辑器：chapterId 绑定真实章节，正文和对话均通过服务端读取。
export default function ChapterPage() {
  return (
    <AppShell>
      <ChapterEditorView />
    </AppShell>
  );
}

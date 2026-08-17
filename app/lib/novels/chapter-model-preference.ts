import { isChatModel, type ChatModel } from "@/lib/chat/models";

export function chapterModelPreferenceKey(novelId: number, chapterId: number): string {
  return `mozhou:chapter-model:${novelId}:${chapterId}`;
}

export function isStoredChapterModel(value: unknown): value is ChatModel {
  return typeof value === "string" && isChatModel(value);
}

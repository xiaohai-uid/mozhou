import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "墨舟 - AI 小说写作平台",
  description: "人物、世界观、章节，AI 记得你笔下的世界。墨舟，为中文网文作者打造的 AI 写作平台。",
};

// 不用 Next 生成的 LayoutProps 全局类型：tsc 在 next build 之前跑时该类型尚不存在（CI 首跑踩坑）
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {children}
      </body>
    </html>
  );
}

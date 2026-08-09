import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex max-w-2xl flex-col items-center gap-8 py-24 text-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-xl font-bold text-white shadow-lg shadow-violet-500/20">
            墨
          </div>
          <span className="text-2xl font-semibold tracking-wide">墨舟</span>
          <Badge variant="secondary" className="text-xs">v0.1 · MVP</Badge>
        </div>

        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            让 AI 与你共同创作
          </h1>
          <p className="max-w-lg text-lg leading-8 text-zinc-400">
            人物、世界观、章节——墨舟记得你笔下的世界。
            <br />
            为中文网文作者打造的 AI 写作平台。
          </p>
        </div>

        <div className="flex gap-4">
          <Link href="/register">
            <Button size="lg" className="bg-violet-600 hover:bg-violet-500">
              开始写作
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">
              登录
            </Button>
          </Link>
        </div>

        <p className="text-sm text-zinc-600">
          写作 · 蒸馏 · 拆解 · 抽卡 —— 功能开发中，敬请期待
        </p>
      </main>
    </div>
  );
}

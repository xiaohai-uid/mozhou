import Link from "next/link";
import {
  BookOpenText,
  Feather,
  MagnifyingGlass,
  PenNib,
  Scissors,
} from "@phosphor-icons/react/dist/ssr";
import { AppShell } from "@/components/app-shell";

/** 工作台：应用首页。写作对话主卡 + 功能入口卡组 + 作品空态。 */
const tools = [
  { href: "/distill", icon: Feather, name: "风格蒸馏", desc: "上传文本，生成可复用风格指南" },
  { href: "/deconstruct", icon: Scissors, name: "小说拆解", desc: "结构、剧情、节奏逐层拆开" },
  { href: "/search", icon: MagnifyingGlass, name: "书源搜索", desc: "主流书源，规则化检索" },
];

export default async function WorkspacePage() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">欢迎回来</h1>
        <p className="mt-2 text-sm text-muted">今天想写点什么？</p>

        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-12">
          {/* 写作对话主卡 */}
          <Link
            href="/chat"
            className="group relative flex flex-col justify-between overflow-hidden rounded-card border border-surface-2 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(127,34,254,0.16),transparent_55%),var(--surface)] p-8 transition hover:border-zinc-600 md:col-span-7"
          >
            <div>
              <PenNib size={30} weight="duotone" className="text-accent" aria-hidden />
              <h2 className="mt-6 text-xl font-semibold text-zinc-100">写作对话</h2>
              <p className="mt-2 max-w-[38ch] text-sm leading-6 text-muted">
                与 AI 共同创作：流式续写、随时中断、多模型切换。
              </p>
            </div>
            <span className="mt-8 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition group-hover:bg-violet-500">
              继续创作
            </span>
          </Link>

          {/* 功能入口卡组 */}
          <div className="flex flex-col gap-5 md:col-span-5">
            {tools.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-1 items-center gap-4 rounded-card border border-surface-2 bg-surface/60 px-6 py-5 transition hover:border-zinc-600"
                >
                  <Icon size={24} weight="duotone" className="shrink-0 text-zinc-400" aria-hidden />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-200">{item.name}</h3>
                    <p className="mt-1 truncate text-xs text-muted">{item.desc}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* 我的作品空态 */}
        <section className="mt-10 rounded-card border border-dashed border-surface-2 px-8 py-12 text-center">
          <BookOpenText size={26} weight="duotone" className="mx-auto text-zinc-500" aria-hidden />
          <h2 className="mt-4 text-base font-semibold text-zinc-200">还没有作品</h2>
          <p className="mx-auto mt-2 max-w-[42ch] text-sm leading-6 text-muted">
            创建你的第一个小说项目：人物库、世界观设定与章节摘要会在这里汇合，AI 记得你笔下的世界。
          </p>
          <Link
            href="/projects"
            className="mt-6 inline-block rounded-full border border-surface-2 px-6 py-2.5 text-sm text-zinc-200 transition hover:border-zinc-600 hover:text-white"
          >
            创建作品
          </Link>
        </section>
      </main>
    </AppShell>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "使用说明 - 墨舟",
};

const steps = [
  {
    title: "1 · 创建作品",
    body: "在「作品」页输入书名和一句话方向即可开书。这句话会进入后续写作上下文，不满意可以随时在正文里纠正。",
  },
  {
    title: "2 · 进入创作台",
    body: "「工作台」是写作主界面：左侧是当前作品的章节、人物、世界观；中间是和墨舟的写作对话；右侧显示本次生成的技能链路证据。",
  },
  {
    title: "3 · 让 AI 起笔",
    body: "空章节里点「让 AI 起笔」，或直接在对话框描述这一章要发生什么。不用选模板，一个画面、一句对白都可以开始。",
  },
  {
    title: "4 · 多轮调整成稿",
    body: "AI 回复确认后插入正文。正文编辑器在对话期间始终可编辑，支持撤销/重做；改完点「保存」。",
  },
  {
    title: "5 · 用专项工具补强",
    body: "「扫榜简报」提供 7 日题材市场简报，「参考拆解」沉淀个人拆解方法包，绑定后自动进入生成上下文。",
  },
];

export default function GuidePage() {
  return (
    <AppShell>
      <main className="mz-page mx-auto w-full max-w-3xl px-6 py-8 lg:px-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Guide</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">使用说明</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          墨舟是给中文网文作者的 AI 写作平台：人物库、世界观设定与章节摘要汇合在同一处，AI 记得你笔下的世界。
          五步上手：
        </p>

        <ol className="mt-6 flex flex-col gap-3">
          {steps.map((step) => (
            <li key={step.title} className="rounded-2xl border border-surface-2 bg-surface/40 p-4">
              <p className="text-sm font-semibold text-zinc-100">{step.title}</p>
              <p className="mt-1 text-sm leading-6 text-zinc-300">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-2xl border border-surface-2 bg-surface/40 p-4">
          <p className="text-sm font-semibold text-zinc-100">数据与账户</p>
          <p className="mt-1 text-sm leading-6 text-zinc-300">
            作品随时可导出，服务不会替你虚构已保存的内容。额度与模型用量在「账户与额度」页查看。
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/projects" className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500">
            去创建作品
          </Link>
          <Link href="/workspace" className="rounded-full border border-surface-2 px-5 py-2 text-sm text-zinc-300 transition hover:border-accent/50 hover:text-accent">
            进入创作台
          </Link>
        </div>
      </main>
    </AppShell>
  );
}

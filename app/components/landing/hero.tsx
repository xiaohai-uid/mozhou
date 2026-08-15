import Link from "next/link";
import { PenNib } from "@phosphor-icons/react/dist/ssr";

/** Hero：大字宣言 + 右侧章节卡，参考番茄榜单风格——深色底、紫罗兰唯一强调。
 *  底部元数据行（来源·状态）呼应榜单页的「来源 · 抓取」细节，增加真实感与秩序感。 */
export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-24 pt-16 md:pt-24 lg:px-16">
      {/* 极淡紫罗兰氛围（顶部微光，唯一一次背景光晕的浅层使用） */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(60%_60%_at_50%_50%,rgba(127,34,254,0.14),transparent_70%)] blur-3xl"
      />
      <div className="relative grid grid-cols-1 items-end gap-14 md:grid-cols-12">
        {/* 左：宣言 */}
        <div className="md:col-span-7">
          <p className="mozhou-rise font-mono text-[11px] uppercase tracking-[0.24em] text-accent" style={{ animationDelay: "0ms" }}>
            为中文网文作者打造
          </p>
          <div className="mozhou-rise mt-6" style={{ animationDelay: "60ms" }}>
            <h1 className="max-w-[9em] text-5xl font-semibold leading-[1.06] tracking-tight md:text-6xl lg:text-7xl">
              让 AI 与你
              <br />
              共同创作
            </h1>
          </div>
          <p
            className="mozhou-rise mt-7 max-w-[42ch] text-lg leading-8 text-muted"
            style={{ animationDelay: "140ms" }}
          >
            人物、世界观、章节，AI 记得你笔下的世界。
            <br />
            流式续写、随时中断、多模型切换。
          </p>
          <div
            className="mozhou-rise mt-10 flex flex-wrap items-center gap-4"
            style={{ animationDelay: "220ms" }}
          >
            <Link
              href="/register"
              className="rounded-full bg-accent px-7 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 active:translate-y-px"
            >
              开始写作
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-surface-2 px-7 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-white active:translate-y-px"
            >
              登录
            </Link>
          </div>
        </div>

        {/* 右：章节卡（参考榜单条目：序号 + 内容 + 状态元数据） */}
        <div className="mozhou-rise md:col-span-5 md:pl-8" style={{ animationDelay: "180ms" }}>
          <div className="overflow-hidden rounded-card-lg border border-surface-2 bg-surface/70 shadow-[0_32px_90px_rgba(0,0,0,0.45)] backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-surface-2 px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-accent" aria-hidden />
                <span className="text-sm text-zinc-200">示例章节 · 第一章</span>
              </div>
              <span className="rank-num text-xs">01</span>
            </div>
            <div className="px-6 py-7">
              <p className="text-[15px] leading-8 text-zinc-300">
                「她合上笔记本时，窗外正好起了风。故事还没有名字，但人物已经在纸上醒来。」
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full border border-surface-2 bg-zinc-950/60 px-3 py-1 text-xs text-faint">
                  流式生成
                </span>
                <span className="rounded-full border border-surface-2 bg-zinc-950/60 px-3 py-1 text-xs text-faint">
                  DeepSeek · GLM 免费
                </span>
                <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
                  技能 · 章节续写
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-surface-2 px-6 py-3 text-xs text-faint">
              <span>墨舟创作台</span>
              <span>你的故事从这里开始</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

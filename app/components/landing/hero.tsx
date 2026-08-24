import Link from "next/link";
import { PenNib } from "@phosphor-icons/react/dist/ssr";

/** 首屏：左侧品牌主张，右侧写作台预览。 */
export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-28 pt-16 md:pb-32 md:pt-24 lg:px-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(60%_60%_at_50%_50%,rgba(139,120,255,0.14),transparent_70%)] blur-3xl"
      />
      <div className="site-container relative grid grid-cols-1 items-center gap-14 md:grid-cols-12 md:gap-10">
        <div className="md:col-span-6 xl:col-span-7">
          <p className="eyebrow mozhou-rise" style={{ animationDelay: "0ms" }}>
            给正在写长篇的人
          </p>
          <div className="mozhou-rise mt-6" style={{ animationDelay: "60ms" }}>
            <h1 className="max-w-[9em] text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.045em] md:text-6xl lg:text-7xl">
              让 AI 与你
              <br />
              共同创作
            </h1>
          </div>
          <p
            className="mozhou-rise mt-7 max-w-[40ch] text-lg leading-8 text-muted"
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
              className="rounded-full bg-accent px-7 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(139,120,255,0.2)] transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
            >
              开始写作
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-surface-2 px-7 py-3 text-sm font-medium text-foreground transition-[border-color,color,transform] hover:border-accent/50 hover:text-white active:translate-y-px"
            >
              登录
            </Link>
          </div>
        </div>

        <div className="mozhou-rise md:col-span-6 xl:col-span-5" style={{ animationDelay: "180ms" }}>
          <div className="surface-panel overflow-hidden rounded-card-lg bg-surface/90 shadow-[0_28px_80px_rgba(0,0,0,0.28)]">
            <div className="flex items-center justify-between border-b border-surface-2 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <PenNib size={16} weight="duotone" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">第一章 · 雨巷</p>
                  <p className="mt-0.5 text-xs text-faint">示例作品 / 正在续写</p>
                </div>
              </div>
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-accent">
                DRAFT
              </span>
            </div>
            <div className="space-y-5 px-5 py-6 md:px-6 md:py-7">
              <div className="space-y-3 text-[15px] leading-8 text-zinc-300">
                <p>她合上笔记本时，窗外正好起了风。</p>
                <p className="text-muted">故事还没有名字，但人物已经在纸上醒来。</p>
                <p className="border-l-2 border-accent/70 pl-4 text-foreground">
                  她抬头看了一眼楼上亮着的那扇窗，决定再往前走一步。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-surface-2 bg-background px-3 py-1 text-xs text-faint">
                  章节续写
                </span>
                <span className="rounded-full border border-surface-2 bg-background px-3 py-1 text-xs text-faint">
                  参考当前正文
                </span>
                <span className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs text-accent">
                  DeepSeek
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-surface-2 pt-4 text-xs text-faint">
                <span>墨舟创作台</span>
                <span className="flex items-center gap-2 text-accent">
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                  AI 正在续写
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

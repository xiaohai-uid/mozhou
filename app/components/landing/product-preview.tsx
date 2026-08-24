import Link from "next/link";

/** MiniChat：保留真实语义结构，展示生成、引用和继续写作状态。 */
function MiniChat() {
  return (
    <div className="surface-panel overflow-hidden rounded-card-lg bg-background shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between border-b border-surface-2 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          <span className="text-sm text-foreground">写作对话 · 示例作品</span>
        </div>
        <span className="font-mono text-[10px] tracking-[0.12em] text-faint">DEEPSEEK / READY</span>
      </div>
      <div className="space-y-4 px-5 py-6 md:px-6">
        <div className="flex justify-end">
          <p className="max-w-[78%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm leading-6 text-white">
            第一章写完了，接下来该让主角出场了。
          </p>
        </div>
        <div className="flex justify-start">
          <p className="max-w-[78%] rounded-2xl rounded-bl-sm border border-surface-2 bg-surface px-4 py-2.5 text-sm leading-6 text-zinc-200">
            她站在雨巷口停了一会儿，把伞收拢。没有立刻进屋，先抬头看了一眼楼上亮着的那扇窗。
          </p>
        </div>
        <div className="flex justify-start">
          <p className="max-w-[78%] rounded-2xl rounded-bl-sm border border-surface-2 bg-surface px-4 py-2.5 text-sm leading-6 text-zinc-200">
            写到这里，伏笔「雨巷的那扇窗」已经埋下
            <span className="mozhou-caret ml-1 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" aria-label="流式输出光标" />
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-surface-2 px-5 py-3 md:px-6">
        <span className="rounded-full border border-accent/30 bg-accent-soft px-3 py-0.5 text-xs text-accent">
          技能 · 章节续写
        </span>
        <span className="rounded-full border border-surface-2 px-3 py-0.5 text-xs text-faint">
          引用当前正文
        </span>
        <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-faint">STREAMING</span>
      </div>
      <div className="border-t border-surface-2 p-3 md:p-4">
        <div className="flex items-center gap-2 rounded-xl border border-surface-2 bg-surface px-3 py-2">
          <input
            readOnly
            placeholder="继续写下去…"
            className="w-full bg-transparent text-sm text-zinc-200 outline-none placeholder:text-faint"
            aria-label="写作输入框（示意）"
          />
          <span className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white">继续</span>
        </div>
      </div>
    </div>
  );
}

/** 产品展示节：左文案右真实组件预览。 */
export function ProductPreview() {
  return (
    <section className="px-6 py-24 lg:px-16">
      <div className="site-container grid grid-cols-1 items-center gap-14 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="font-mono text-[11px] tracking-[0.16em] text-accent">写作台 / 01</p>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] md:text-5xl">
            AI 与你共同创作
          </h2>
          <p className="mt-6 max-w-[40ch] text-base leading-7 text-muted">
            流式输出、随时中断、多模型切换。草稿不是终点，对话才是写作的开始。
          </p>
          <Link
            href="/login"
            className="mt-8 inline-block rounded-full border border-surface-2 px-6 py-2.5 text-sm text-foreground transition-[border-color,color,transform] hover:border-accent/50 hover:text-white active:translate-y-px"
          >
            进入工作台
          </Link>
        </div>
        <div className="md:col-span-7">
          <MiniChat />
        </div>
      </div>
    </section>
  );
}

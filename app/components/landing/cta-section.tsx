import Link from "next/link";

/** 收尾 CTA：以轻量编辑面板收束页面，保留单一主动作。 */
export function CtaSection() {
  return (
    <section className="relative overflow-hidden px-6 py-32 lg:px-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(70%_100%_at_50%_100%,rgba(139,120,255,0.14),transparent_70%)]"
      />
      <div className="site-container relative flex max-w-3xl flex-col items-center gap-8 rounded-card-lg border border-surface-2 bg-surface/45 px-6 py-20 text-center md:px-12">
        <p className="font-mono text-[11px] tracking-[0.16em] text-accent">从下一章开始</p>
        <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] md:text-6xl">现在，开始你的下一章</h2>
        <p className="text-sm text-muted">数据自有，随时导出。</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/register"
            className="rounded-full bg-accent px-10 py-4 text-base font-semibold text-white shadow-[0_12px_30px_rgba(139,120,255,0.2)] transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
          >
            开始写作
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-surface-2 px-8 py-4 text-sm text-foreground transition-[border-color,color,transform] hover:border-accent/50 hover:text-white active:translate-y-px"
          >
            登录
          </Link>
        </div>
      </div>
    </section>
  );
}

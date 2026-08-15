import Link from "next/link";

/** 收尾 CTA：居中低区，全站唯一一次明显氛围渐变（收束感）。
 *  主行动与 Hero 同 label（技能：同一 intent 一个 label）。 */
export function CtaSection() {
  return (
    <section className="relative overflow-hidden px-6 py-32 lg:px-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(80%_100%_at_50%_100%,rgba(79,57,246,0.16),rgba(127,34,254,0.08)_55%,transparent)]"
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent">
          免费开始 · 无需信用卡
        </p>
        <h2 className="text-4xl font-semibold tracking-tight md:text-6xl">
          现在，开始你的下一章
        </h2>
        <p className="text-sm text-muted">数据自有，随时导出</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/register"
            className="rounded-full bg-accent px-10 py-4 text-base font-semibold text-white shadow-[0_12px_40px_rgba(127,34,254,0.25)] transition hover:bg-violet-500 active:translate-y-px"
          >
            开始写作
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-surface-2 px-8 py-4 text-sm text-zinc-200 transition hover:border-zinc-600 hover:text-white"
          >
            登录
          </Link>
        </div>
      </div>
    </section>
  );
}

/** 记忆节：Off-grid editorial，真实《零界道种》数据档案卡（非占位）。
 *  全站第二个 eyebrow（预算 6 节 ≤ 2）。 */
const cards = [
  { kind: "人物", name: "陆沉舟", note: "阿雀的兄长，沉默寡言，总在夜里出门" },
  { kind: "设定", name: "零界", note: "火苗偏斜的方向，镇上无人提及的地名" },
  { kind: "章节", name: "灰烬有籽", note: "第一章 · 灯芯在灰罐里亮了一整夜" },
];

export function MemorySection() {
  return (
    <section className="relative overflow-hidden px-6 py-32 lg:px-16">
      {/* 极淡紫罗兰氛围（低饱和，唯一一次背景微光之外的径向） */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/3 size-[480px] rounded-full bg-accent/8 blur-[120px]"
      />
      <div className="relative grid grid-cols-1 items-end gap-14 md:grid-cols-12">
        <div className="md:col-span-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">
            长文记忆
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
            AI 记得你笔下的世界
          </h2>
          <p className="mt-6 max-w-[42ch] text-base leading-7 text-muted">
            人物库、世界观设定、章节摘要，向量检索，永不遗忘。三万字后，它还记得第一章埋下的那粒灰烬。
          </p>
        </div>
        <div className="md:col-span-5">
          <div className="flex flex-col gap-3">
            {cards.map((card, i) => (
              <div
                key={card.name}
                className="rounded-card border border-surface-2 bg-surface px-6 py-5 transition hover:border-zinc-600"
                style={{ transform: `translateX(${i * 14}px)` }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-base font-semibold text-zinc-100">
                    {card.name}
                  </h3>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
                    {card.kind}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-6 text-muted">{card.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

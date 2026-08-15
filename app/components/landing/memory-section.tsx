/** 记忆节：Off-grid editorial，中性示例档案卡（非真实作品数据）。
 *  全站第二个 eyebrow（预算 6 节 ≤ 2）。 */
const cards = [
  { kind: "人物", name: "沈砚", note: "主角，白天是古籍修复师，夜里整理自己的手稿" },
  { kind: "设定", name: "雨巷", note: "主角常走的那条街，每次转折都发生在这里" },
  { kind: "章节", name: "第一章", note: "开头埋下信物伏笔，第三卷回收" },
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
            人物库、世界观设定、章节摘要，向量检索，永不遗忘。三万字后，它还记得第一章埋下的那个伏笔。
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

/** 记忆节：用错位档案卡表现人物、设定和章节之间的关系。 */
const cards = [
  { kind: "人物", name: "沈砚", note: "主角，白天是古籍修复师，夜里整理自己的手稿", offset: "md:translate-x-0" },
  { kind: "设定", name: "雨巷", note: "主角常走的那条街，每次转折都发生在这里", offset: "md:translate-x-3" },
  { kind: "章节", name: "第一章", note: "开头埋下信物伏笔，第三卷回收", offset: "md:translate-x-6" },
];

export function MemorySection() {
  return (
    <section className="relative overflow-hidden px-6 py-24 lg:px-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/3 size-[480px] rounded-full bg-accent/6 blur-[120px]"
      />
      <div className="site-container relative grid grid-cols-1 items-center gap-14 md:grid-cols-12">
        <div className="md:col-span-7">
          <p className="font-mono text-[11px] tracking-[0.16em] text-accent">写作台 / 02</p>
          <h2 className="mt-4 max-w-[12em] text-balance text-3xl font-semibold tracking-[-0.035em] md:text-5xl">
            AI 记得你笔下的世界
          </h2>
          <p className="mt-6 max-w-[42ch] text-base leading-7 text-muted">
            人物库、世界观设定、章节摘要会在生成时作为故事参考。把关键事实放进工作台，写得更长也能少一些前后矛盾。
          </p>
        </div>
        <div className="md:col-span-5">
          <div className="relative flex flex-col gap-3 md:pl-5">
            <div className="absolute bottom-6 left-1 top-6 hidden w-px bg-surface-2 md:block" aria-hidden />
            {cards.map((card, i) => (
              <div
                key={card.name}
                className={`surface-panel relative rounded-card px-6 py-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/40 ${card.offset}`}
              >
                <span
                  className="absolute -left-[1.55rem] top-7 hidden size-2 rounded-full border-2 border-background bg-accent md:block"
                  aria-hidden
                />
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs tracking-[0.16em] text-accent">0{i + 1}</span>
                    <h3 className="text-base font-semibold text-foreground">{card.name}</h3>
                  </div>
                  <span className="font-mono text-[11px] tracking-[0.12em] text-faint">{card.kind}</span>
                </div>
                <p className="mt-2 pl-8 text-sm leading-6 text-muted">{card.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

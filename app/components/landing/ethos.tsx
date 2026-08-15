/** 理念声明节：三项承诺，保持安静并减少装饰性编号。 */
const principles = [
  { title: "自有品牌", note: "品牌与文案全原创" },
  { title: "模型自由", note: "DeepSeek 免费模型为主，高级模型 BYOK" },
  { title: "数据自有", note: "作者数据归属作者" },
];

export function Ethos() {
  return (
    <section className="px-6 py-28 lg:px-16">
      <div className="site-container max-w-4xl">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {principles.map((p, i) => (
            <div key={p.title} className="border-t border-surface-2 pt-6">
              <span className="font-mono text-[10px] tracking-[0.18em] text-accent">0{i + 1} / 承诺</span>
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-foreground md:text-2xl">
                {p.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted">{p.note}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

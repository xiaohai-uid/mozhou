/** 理念声明节：极简三段，全站最安静（节奏变化），无 CTA。 */
const principles = [
  { title: "自有品牌", note: "品牌与文案全原创" },
  { title: "模型自由", note: "DeepSeek 免费模型为主，高级模型 BYOK" },
  { title: "数据自有", note: "作者数据归属作者" },
];

export function Ethos() {
  return (
    <section className="px-6 py-32 lg:px-16">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-12 text-center">
        {principles.map((p, i) => (
          <div key={p.title} className="w-full">
            <h2 className="text-3xl font-semibold tracking-[0.12em] text-zinc-100 md:text-5xl">
              {p.title}
            </h2>
            <p className="mt-3 text-sm tracking-wide text-faint">{p.note}</p>
            {i < principles.length - 1 && (
              <div className="mx-auto mt-12 h-px w-24 bg-accent/40" aria-hidden />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

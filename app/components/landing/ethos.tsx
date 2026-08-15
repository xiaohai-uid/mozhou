/** 理念声明节：三段并排加序号（参考榜单排版），全站最安静，无 CTA。 */
const principles = [
  { title: "自有品牌", note: "品牌与文案全原创" },
  { title: "模型自由", note: "DeepSeek 免费模型为主，高级模型 BYOK" },
  { title: "数据自有", note: "作者数据归属作者" },
];

export function Ethos() {
  return (
    <section className="px-6 py-28 lg:px-16">
      <div className="mx-auto max-w-4xl">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {principles.map((p, i) => (
            <div key={p.title} className="border-t border-surface-2 pt-6">
              <span className="rank-num text-xs">0{i + 1}</span>
              <h2 className="mt-3 text-xl font-semibold tracking-wide text-zinc-100 md:text-2xl">
                {p.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-faint">{p.note}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

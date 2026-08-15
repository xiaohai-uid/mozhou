import {
  BookOpenText,
  Feather,
  MagnifyingGlass,
  PenNib,
  Scissors,
  Shuffle,
} from "@phosphor-icons/react/dist/ssr";

/** 功能 bento：主写作单元跨两行，其余能力填满网格，避免孤立卡片。 */
const items = [
  {
    icon: PenNib,
    title: "写作对话",
    desc: "流式续写、随时中断、多模型切换",
    span: "md:col-span-4 md:row-span-2",
    variant: "featured" as const,
  },
  {
    icon: BookOpenText,
    title: "长文记忆",
    desc: "人物库、世界观、章节摘要，向量检索",
    span: "md:col-span-2",
    variant: "memory" as const,
  },
  {
    icon: Feather,
    title: "风格蒸馏",
    desc: "上传文本，生成可复用风格指南",
    span: "md:col-span-2",
    variant: "utility" as const,
  },
  {
    icon: Scissors,
    title: "小说拆解",
    desc: "结构、剧情、节奏逐层拆开",
    span: "md:col-span-2",
    variant: "utility" as const,
  },
  {
    icon: MagnifyingGlass,
    title: "书源搜索",
    desc: "主流书源，规则化检索",
    span: "md:col-span-2",
    variant: "utility" as const,
  },
  {
    icon: Shuffle,
    title: "抽卡模式",
    desc: "多模型多风格对比输出",
    span: "md:col-span-2",
    variant: "utility" as const,
  },
];

export function FeatureBento() {
  return (
    <section className="px-6 py-24 lg:px-16">
      <div className="site-container flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">写作台</p>
          <h2 className="mt-4 max-w-[12em] text-balance text-3xl font-semibold tracking-[-0.035em] md:text-5xl">
            写作、蒸馏、拆解、抽卡
          </h2>
        </div>
        <p className="max-w-[32ch] text-sm leading-6 text-faint md:text-right">
          一个写作台，六件顺手的事。
        </p>
      </div>
      <div className="site-container mt-12 grid grid-cols-1 gap-4 md:grid-flow-dense md:grid-cols-6">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className={`group surface-panel flex flex-col rounded-card p-6 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-accent/40 ${item.span} ${
                item.variant === "featured"
                  ? "min-h-[220px] bg-[radial-gradient(120%_120%_at_0%_0%,rgba(139,120,255,0.16),transparent_62%),var(--surface)] md:min-h-[360px]"
                  : item.variant === "memory"
                    ? "bg-surface"
                    : "bg-surface/70"
              }`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                {item.variant === "memory" ? (
                  <div className="flex flex-wrap gap-2">
                    {["世界观", "人物库", "章节摘要"].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-surface-2 bg-background px-3 py-1 text-xs text-zinc-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <Icon
                    size={item.variant === "featured" ? 30 : 24}
                    weight="duotone"
                    className={item.variant === "featured" ? "text-accent" : "text-faint"}
                  />
                )}
                <span className="font-mono text-[10px] tracking-[0.16em] text-faint">0{i + 1}</span>
              </div>
              <div className={item.variant === "featured" ? "mt-auto pt-16" : "pt-10"}>
                <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 max-w-[34ch] text-sm leading-6 text-muted">{item.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

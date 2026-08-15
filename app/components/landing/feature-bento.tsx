import {
  BookOpenText,
  Feather,
  MagnifyingGlass,
  PenNib,
  Scissors,
  Shuffle,
} from "@phosphor-icons/react/dist/ssr";

/** 功能 bento：6 格不对称网格，2 大格有视觉变化（渐变格 + 标签格），
 *  全部卡片真实圆角 + hover 边框提亮（参考榜单风格：序号点缀）。 */
const items = [
  {
    icon: PenNib,
    title: "写作对话",
    desc: "流式续写、随时中断、多模型切换",
    span: "md:col-span-4",
    variant: "gradient" as const,
  },
  {
    icon: BookOpenText,
    title: "长文记忆",
    desc: "人物库、世界观、章节摘要，向量检索",
    span: "md:col-span-2",
    variant: "tags" as const,
  },
  {
    icon: Feather,
    title: "风格蒸馏",
    desc: "上传文本，生成可复用风格指南",
    span: "md:col-span-2",
    variant: "flat" as const,
  },
  {
    icon: Scissors,
    title: "小说拆解",
    desc: "结构、剧情、节奏逐层拆开",
    span: "md:col-span-2",
    variant: "flat" as const,
  },
  {
    icon: MagnifyingGlass,
    title: "书源搜索",
    desc: "主流书源，规则化检索",
    span: "md:col-span-2",
    variant: "flat" as const,
  },
  {
    icon: Shuffle,
    title: "抽卡模式",
    desc: "多模型多风格对比输出",
    span: "md:col-span-2",
    variant: "flat" as const,
  },
];

export function FeatureBento() {
  return (
    <section className="px-6 py-24 lg:px-16">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent">功能</p>
          <h2 className="mt-4 max-w-[12em] text-3xl font-semibold tracking-tight md:text-5xl">
            写作、蒸馏、拆解、抽卡
          </h2>
        </div>
        <p className="max-w-[32ch] text-sm leading-6 text-faint md:text-right">
          一个写作台，六件顺手的事。
        </p>
      </div>
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className={`group rounded-card border border-surface-2 p-7 transition-colors hover:border-zinc-600 ${item.span} ${
                item.variant === "gradient"
                  ? "bg-[radial-gradient(120%_120%_at_0%_0%,rgba(127,34,254,0.18),transparent_60%),var(--surface)]"
                  : item.variant === "tags"
                    ? "bg-surface"
                    : "bg-surface/60"
              }`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between">
                {item.variant === "tags" ? (
                  <div className="flex flex-wrap gap-2">
                    {["世界观", "人物库", "章节摘要"].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-surface-2 bg-zinc-950/60 px-3 py-1 text-xs text-zinc-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <Icon
                    size={26}
                    weight="duotone"
                    className={item.variant === "gradient" ? "text-accent" : "text-zinc-400"}
                  />
                )}
                <span className="rank-num text-xs">0{i + 1}</span>
              </div>
              <h3 className="mt-6 text-base font-semibold text-zinc-100">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{item.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

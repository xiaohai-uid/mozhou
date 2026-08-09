// PROTOTYPE — 工单 05 项目页信息架构：?variant=A|B|C 切换（throwaway route，验收后移出 main）
import { VariantA, VariantB, VariantC } from "./variants";
import { PrototypeSwitcher } from "@/components/prototype-switcher";

export default async function NovelProjectPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const { variant } = await searchParams;
  const v = (variant ?? "A").toUpperCase();

  return (
    <main className="flex h-[calc(100vh-1px)] flex-col bg-zinc-950 p-4 text-zinc-100">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium uppercase tracking-widest text-violet-500">
            PROTOTYPE · 工单 05 项目页
          </span>
          <h1 className="mt-0.5 text-sm text-zinc-400">
            问题：章节 + 人物库 + 世界观在一页里怎么组织？（变体间结构差异，非换皮）
          </h1>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {v === "A" && <VariantA />}
        {v === "B" && <VariantB />}
        {v === "C" && <VariantC />}
      </div>
      {process.env.NODE_ENV !== "production" && <PrototypeSwitcher />}
    </main>
  );
}

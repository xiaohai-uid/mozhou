import Link from "next/link";
import { Hero } from "@/components/landing/hero";
import { FeatureBento } from "@/components/landing/feature-bento";
import { ProductPreview } from "@/components/landing/product-preview";
import { MemorySection } from "@/components/landing/memory-section";
import { Ethos } from "@/components/landing/ethos";
import { CtaSection } from "@/components/landing/cta-section";

/** 墨舟 Landing：六节，深色编辑器风，紫罗兰单 accent。
 *  导航单行 ≤72px；CTA 全站统一 label（开始写作 / 登录）。 */
export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex h-16 items-center justify-between border-b border-surface-2 px-6 lg:px-16">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white">
            墨
          </span>
          <span className="text-base font-semibold tracking-wide">墨舟</span>
        </Link>
        <nav className="flex items-center gap-3" aria-label="主导航">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-sm text-zinc-300 transition hover:text-white"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500 active:translate-y-px"
          >
            开始写作
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <Hero />
        <FeatureBento />
        <ProductPreview />
        <MemorySection />
        <Ethos />
        <CtaSection />
      </main>

      <footer className="border-t border-surface-2 px-6 py-8 lg:px-16">
        <div className="flex flex-col items-start justify-between gap-3 text-sm text-faint md:flex-row md:items-center">
          <span>墨舟，为中文网文作者打造的 AI 写作平台</span>
          <span>自有品牌 · 模型自由，数据自有</span>
        </div>
      </footer>
    </div>
  );
}

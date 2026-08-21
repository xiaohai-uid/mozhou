import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
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
      <a
        href="#main-content"
        className="absolute left-4 top-4 z-50 -translate-y-20 rounded-full bg-foreground px-4 py-2 text-sm text-background transition-transform focus:translate-y-0"
      >
        跳到主要内容
      </a>

      <header className="border-b border-surface-2">
        <div className="site-container flex h-16 items-center justify-between px-6 lg:px-16">
          <BrandLockup href="/" ariaLabel="墨舟首页" />
          <nav className="flex items-center gap-2" aria-label="主导航">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white shadow-[0_8px_24px_rgba(139,120,255,0.18)] transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
            >
              开始写作
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <Hero />
        <FeatureBento />
        <ProductPreview />
        <MemorySection />
        <Ethos />
        <CtaSection />
      </main>

      <footer className="border-t border-surface-2 px-6 py-8 lg:px-16">
        <div className="site-container flex flex-col items-start justify-between gap-3 text-sm text-faint md:flex-row md:items-center">
          <span>墨舟，为中文网文作者打造的 AI 写作平台</span>
          <span>自有品牌 · 模型自由 · 数据自有</span>
        </div>
      </footer>
    </div>
  );
}

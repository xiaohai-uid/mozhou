import Link from "next/link";
import { PenNib } from "@phosphor-icons/react/dist/ssr";

/** Hero：Editorial Manifesto 变体，左对齐大字宣言 + 右侧真实章节片段卡。
 *  无 eyebrow、无版本标、无假截图（技能 4.7 / 9.F）。 */
export function Hero() {
  return (
    <section className="grid min-h-[100dvh] grid-cols-1 items-end gap-12 px-6 pb-20 pt-24 md:grid-cols-12 lg:px-16">
      <div className="md:col-span-7">
        <div className="mozhou-rise" style={{ animationDelay: "0ms" }}>
          <h1 className="max-w-[10em] text-5xl font-semibold leading-[1.08] tracking-tight md:text-6xl lg:text-7xl">
            让 AI 与你
            <br />
            共同创作
          </h1>
        </div>
        <p
          className="mozhou-rise mt-8 max-w-[42ch] text-lg leading-8 text-muted"
          style={{ animationDelay: "120ms" }}
        >
          人物、世界观、章节，AI 记得你笔下的世界。
          <br />
          为中文网文作者打造的 AI 写作平台。
        </p>
        <div
          className="mozhou-rise mt-10 flex flex-wrap items-center gap-4"
          style={{ animationDelay: "200ms" }}
        >
          <Link
            href="/register"
            className="rounded-full bg-accent px-7 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 active:translate-y-px"
          >
            开始写作
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-surface-2 px-7 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-white active:translate-y-px"
          >
            登录
          </Link>
        </div>
      </div>

      {/* 右侧：真实章节片段卡（《零界道种》第一章，非占位、非假截图） */}
      <div className="md:col-span-5 md:pl-8">
        <figure className="mozhou-rise rounded-card border border-surface-2 bg-surface p-7 shadow-[0_24px_80px_rgba(0,0,0,0.35)]" style={{ animationDelay: "240ms" }}>
          <figcaption className="flex items-center gap-2 text-xs text-faint">
            <PenNib size={14} className="text-accent" weight="duotone" />
            《零界道种》第一章 · 灰烬有籽
          </figcaption>
          <blockquote className="mt-5 text-[15px] leading-7 text-zinc-300">
            「火苗在灰罐里，静了一会儿，朝零界的方向，又偏了偏。」
          </blockquote>
          <p className="mt-4 text-xs leading-6 text-faint">
            你的故事从这里开始。墨舟记住每一个伏笔、每一次转身。
          </p>
        </figure>
      </div>
    </section>
  );
}

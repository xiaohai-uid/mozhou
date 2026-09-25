import React, { useState } from 'react';
import { GENRE_PRESETS } from './genrePresets';
import type { GenreKit } from './genrePresets';
import { post } from '../lib/post';
import type { BookInfo } from '../shell/workbenchStorage';

const CATEGORIES = ['all', ...Array.from(new Set(GENRE_PRESETS.map((kit) => kit.category)))] as const;

export const GenreKitMarketplaceView: React.FC<{
  book?: BookInfo | null | undefined;
}> = ({ book }) => {
  const [selectedKit, setSelectedKit] = useState<GenreKit>(GENRE_PRESETS[0]!);
  const [applied, setApplied] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedDetail, setAppliedDetail] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const filteredKits = GENRE_PRESETS.filter((kit) =>
    activeCategory === 'all' ? true : kit.category === activeCategory,
  );

  const handleApply = async (kit: GenreKit): Promise<void> => {
    setApplyError(null);
    setAppliedDetail(null);
    if (!book?.root) {
      setApplyError('当前未建立/未打开作品，请先建书后再载入流派设定。');
      setApplied(null);
      return;
    }
    try {
      const result = await post<{
        ok: boolean;
        appliedCount?: number;
        skippedCount?: number;
      }>('/api/genre-kit.apply', {
        root: book.root,
        kitId: kit.id,
      });
      setApplied(kit.id);
      const appliedCount = result.appliedCount ?? 0;
      const skippedCount = result.skippedCount ?? 0;
      setAppliedDetail(
        skippedCount > 0
          ? `已注入 ${appliedCount} 项流派设定与开篇大纲脚手架到《${book.title}》；另有 ${skippedCount} 个同名文件已存在，已保留你原有内容、未做覆盖。`
          : `已注入 ${appliedCount} 项流派设定与开篇大纲脚手架到《${book.title}》。`,
      );
    } catch (error) {
      setApplyError((error as Error).message);
      setApplied(null);
    }
  };

  return (
    <section className="flex h-full min-h-[600px] w-full flex-col gap-5 overflow-y-auto p-6" aria-labelledby="genre-kits-title">
      <header className="flex flex-col gap-4 border-b border-[var(--hairline)] pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <h2 id="genre-kits-title" className="m-0 text-base font-semibold text-[var(--foreground)]">
              网文流派资产库
            </h2>
            <span className="rounded-md bg-[var(--jade-soft)] px-2 py-1 font-mono text-[10px] text-[var(--accent-strong)]">
              {GENRE_PRESETS.length} 套可用
            </span>
          </div>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">
            把成熟流派的世界观底座、金手指规则、避雷红线与开篇节拍注入当前作品。应用前可先完整核对内容。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1" aria-label="流派分类筛选">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={activeCategory === category}
              onClick={() => setActiveCategory(category)}
              className={`min-h-8 rounded-md px-2.5 text-[11px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                activeCategory === category
                  ? 'bg-[var(--gold-soft)] font-medium text-[var(--gold-bright)] shadow-[inset_0_0_0_1px_var(--gold-line-soft)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]'
              }`}
            >
              {category === 'all' ? '全部流派' : category}
            </button>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)]">
        <nav className="max-h-[660px] space-y-2 overflow-y-auto pr-1" aria-label="流派套件列表">
          {filteredKits.map((kit) => {
            const isSelected = selectedKit.id === kit.id;
            return (
              <button
                key={kit.id}
                type="button"
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => setSelectedKit(kit)}
                className={`w-full rounded-xl px-4 py-3.5 text-left transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.99] ${
                  isSelected
                    ? 'bg-[var(--jade-soft)] shadow-[inset_0_0_0_1px_var(--jade-line)]'
                    : 'bg-[var(--surface)] hover:bg-[var(--surface-raised)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-semibold text-[var(--foreground)]">{kit.name}</span>
                  <span className="flex-none rounded-md bg-[var(--surface-2)] px-2 py-1 text-[9px] text-[var(--text-faint)]">
                    {kit.category}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] font-medium text-[var(--accent-strong)]">{kit.tag}</div>
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-[var(--text-muted)]">
                  {kit.synopsis}
                </p>
              </button>
            );
          })}
        </nav>

        <article className="flex min-w-0 flex-col justify-between gap-5 rounded-[14px] border border-[var(--hairline-strong)] bg-[var(--surface-raised)] p-6 shadow-[0_12px_32px_rgba(32,42,53,0.07)]">
          <div className="space-y-5">
            <div className="flex flex-col gap-4 border-b border-[var(--hairline)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="m-0 text-base font-semibold text-[var(--foreground)]">{selectedKit.name}</h3>
                  <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                    {selectedKit.category}
                  </span>
                </div>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">核心标签：{selectedKit.tag}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleApply(selectedKit)}
                className="min-h-10 flex-none rounded-lg bg-[var(--gold-bright)] px-4 text-xs font-semibold text-[var(--background)] transition-[background-color,transform] duration-150 hover:bg-[var(--gold)] active:scale-[0.96]"
              >
                {applied === selectedKit.id ? '已应用到当前作品' : '载入当前作品'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <section className="rounded-xl bg-[var(--surface-2)] p-4" aria-labelledby="genre-kit-power">
                <span className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--accent-strong)]">SYSTEM</span>
                <h4 id="genre-kit-power" className="m-0 text-xs font-semibold text-[var(--text-muted)]">核心金手指预设</h4>
                <p className="mt-2 text-xs font-medium leading-5 text-[var(--foreground)]">{selectedKit.goldenFinger}</p>
              </section>
              <section className="rounded-xl bg-[var(--surface-2)] p-4" aria-labelledby="genre-kit-rule">
                <span className="mb-1.5 block font-mono text-[9px] font-bold tracking-[0.14em] text-[var(--gold-bright)]">RULE</span>
                <h4 id="genre-kit-rule" className="m-0 text-xs font-semibold text-[var(--text-muted)]">核心天道运行规则</h4>
                <p className="mt-2 text-xs font-medium leading-5 text-[var(--foreground)]">{selectedKit.coreRule}</p>
              </section>
            </div>

            <section aria-labelledby="genre-kit-redlines">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 id="genre-kit-redlines" className="m-0 text-[11px] font-semibold text-[var(--text-muted)]">流派避雷红线</h4>
                <span className="text-[10px] text-[var(--text-faint)]">生成时作为约束注入</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedKit.bannedTropes.map((trope) => (
                  <span
                    key={trope}
                    className="rounded-lg bg-[rgba(179,66,58,0.08)] px-2.5 py-1 text-[11px] text-[var(--danger)] shadow-[inset_0_0_0_1px_rgba(179,66,58,0.18)]"
                  >
                    {trope}
                  </span>
                ))}
              </div>
            </section>

            <section aria-labelledby="genre-kit-beats">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 id="genre-kit-beats" className="m-0 text-[11px] font-semibold text-[var(--text-muted)]">黄金三章节拍</h4>
                <span className="text-[10px] text-[var(--text-faint)]">Opening beats</span>
              </div>
              <ol className="space-y-2">
                {selectedKit.openingBeats.map((beat, index) => (
                  <li key={beat} className="flex items-start gap-3 rounded-lg bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--foreground)]">
                    <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-[var(--jade-soft)] font-mono text-[10px] font-semibold text-[var(--accent-strong)]">
                      {index + 1}
                    </span>
                    <span>{beat}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="space-y-2">
            {applyError && (
              <div role="alert" className="rounded-lg bg-[rgba(179,66,58,0.08)] p-3 text-xs text-[var(--danger)] shadow-[inset_0_0_0_1px_rgba(179,66,58,0.18)]">
                {applyError}
              </div>
            )}
            {appliedDetail && (
              <div role="status" className="rounded-lg bg-[rgba(46,125,84,0.08)] p-3 text-xs text-[var(--success)] shadow-[inset_0_0_0_1px_rgba(46,125,84,0.18)]">
                {appliedDetail}
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
};

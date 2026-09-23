/**
 * @mozhou/runtime · 官方标准能力配方预设（Canonical Recipes）。
 * 消除高频任务（如正文草稿生成）调用方每次手写 20+ 行繁重 AST 样板的负担。
 */
import type { CapabilityRecipe } from './recipe/types.js';

export function createDraftRecipe(options: {
  readonly proseRelPath: string;
}): CapabilityRecipe {
  if (options.proseRelPath.trim().length === 0) {
    throw new Error('proseRelPath must be a non-empty canonical path');
  }
  const authorityState = options.proseRelPath;

  return {
    id: 'chapter-drafting',
    recipeVersion: '0.1.1',
    source: {
      repo: 'original',
      commit: '0'.repeat(40),
      license: 'original',
      refinedAt: '2026-09-03',
      refineNote: 'release hardening: compiled context',
    },
    brief: {
      capability: '正文草稿流式生成',
      runtimeSemantics: 'Context Compiler → provider；断流标 partial、半稿持久保留',
      triggers: ['draft'],
    },
    taskType: 'CHAPTER_DRAFTING',
    entry: {
      routerDoc: 'docs/router.md',
      phases: ['draft'],
      stopPoints: [],
    },
    references: [],
    artifacts: [],
    prechecks: [],
    trackingGate: {
      authorityState,
      casField: 'revision',
      transactionModes: ['append'],
      derivedViews: [],
      budgets: { hotContextBytes: 48_000, perChapterReads: [] },
      failureTaxonomy: 'validationFailed',
      hookPoint: 'postWrite',
    },
    contextBudget: {
      hotContextBytes: 48_000,
      fixedSections: [],
      perChapterReads: [],
    },
  };
}

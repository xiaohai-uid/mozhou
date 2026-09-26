/**
 * @mozhou/quality-engine/de-ai —— 浏览器安全子路径导出。
 *
 * 为什么不从包根导入：包根（./index.js）重导出 policy.ts（node:crypto）与
 * staleness.ts（node:fs），进不了浏览器包。本入口只承载「无 Node 依赖、
 * 纯函数、可在渲染进程逐键调用」的 De-AI 机检能力。
 *
 * 不变量（由 de-ai.browser-safe.test.ts 守护）：本文件及其相对导入闭包内
 * 不得出现任何 `node:*` / `fs` / `crypto` 依赖，也不得经 ./policy.js、
 * ./staleness.js 回流到包根。
 *
 * 新增导出必须显式过此文件——接口即调用方必须学习的全部知识。
 */
export {
  runDeAiDiagnostics,
  TIER_1_PATTERNS,
  TIER_2_CLUSTER_TERMS,
} from './de-ai-engine.js';
export type {
  DeAiEngineReport,
  DeAiFinding,
  DeAiSeverity,
} from './de-ai-engine.js';

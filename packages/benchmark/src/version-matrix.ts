/**
 * M14 Recipe↔Benchmark 版本矩阵钩子——消费侧（T20 · #44）。
 *
 * W6 依赖解耦：配方版本解析下沉至 @mozhou/runtime，矩阵行类型与合成下沉至 @mozhou/quality-engine；
 * 本文件作为兼容转发薄层。
 */

export {
  RECIPE_SNAPSHOT_KEY,
  readRecipeVersionFromPayload,
} from '@mozhou/runtime';

export {
  matrixRowFor,
} from '@mozhou/quality-engine';

export type {
  MatrixRowInput,
  VersionMatrixRow,
} from '@mozhou/quality-engine';

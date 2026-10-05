/**
 * M14 Recipe 版本解析器（W6 依赖解耦下沉自 packages/benchmark/src/version-matrix.ts）。
 *
 * 消费端：从 GenerationStarted 事件载荷读取配方解析快照中的 recipeVersion。
 */

/** M14 约定键：GenerationStarted 载荷上解析快照的挂载点（T15 loader.ts 同源）。 */
export const RECIPE_SNAPSHOT_KEY = 'recipeSnapshot';

/**
 * 机械读版本：payload[recipeSnapshot].recipe.recipeVersion 三级路径逐级收窄，
 * 任一级缺面/坏形 ⇒ null（显式缺面不猜版本）。载荷形状 = Readonly<Record<string,
 * unknown>>（T15 产出签名原样），不要求调用方先过完整 schema 校验。
 */
export function readRecipeVersionFromPayload(payload: Readonly<Record<string, unknown>>): string | null {
  const snapshot: unknown = payload[RECIPE_SNAPSHOT_KEY];
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;
  const recipe: unknown = (snapshot as Record<string, unknown>)['recipe'];
  if (typeof recipe !== 'object' || recipe === null || Array.isArray(recipe)) return null;
  const version: unknown = (recipe as Record<string, unknown>)['recipeVersion'];
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/**
 * 漫剧分镜 V1 共享模型（T02 契约）。
 *
 * 移入 shared/：供 UI 与 server 共享引用，browser-safe。
 */
export const STORYBOARD_SCHEMA_VERSION = 1;
/** V1 上限（brief.storyboard.generation）：超限明确拒绝，禁止静默截断。 */
export const STORYBOARD_LIMITS = {
    maxSourceCharacters: 12000,
    maxShots: 60,
    maxResponseBytes: 262144,
    maxCharacters: 50,
    maxDialoguePerShot: 20,
    maxExcerptCharacters: 400,
};

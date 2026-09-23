/**
 * 漫剧分镜离开保护（U06 · 共享脏状态注册处）+ 保存状态三态（U05 · 徽标真源）：
 * 分镜工作区有未保存修改（含未保存候选）时，外壳层的离开路径
 * （切页/切书/关闭抽屉/刷新关闭）必须先经作者确认——不静默丢内容。
 * 三态语义（U05）：idle=无工作文档（就绪）· dirty=有未保存修改 · saved=文档已保存。
 * 空文档绝不呈现「已保存」——徽标文字必须与真实保存状态一致。
 */
export type StoryboardSaveState = 'idle' | 'dirty' | 'saved'

let saveState: StoryboardSaveState = 'idle'
const listeners = new Set<(s: StoryboardSaveState) => void>()

export function setStoryboardSaveState(state: StoryboardSaveState): void {
  if (saveState === state) return
  saveState = state
  listeners.forEach((l) => l(state))
}

export function getStoryboardSaveState(): StoryboardSaveState {
  return saveState
}

export function isStoryboardDirty(): boolean {
  return saveState === 'dirty'
}

export function onStoryboardSaveState(l: (s: StoryboardSaveState) => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** 外壳统一的离开确认文案；返回 true=允许离开。 */
export function confirmStoryboardLeave(action: string): boolean {
  if (!isStoryboardDirty()) return true
  return window.confirm(`漫剧分镜有未保存修改——${action}将丢弃。可先「保存」，或继续离开。`)
}

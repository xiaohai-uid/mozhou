/**
 * 网文灵感工坊候选词条常量表与安全采样器（双端共享，消除重复与弱随机数警告）。
 */

export const INSPIRATION_CHARACTERS = [
  '陆玄',
  '林青锋',
  '叶知秋',
  '赵九霄',
  '楚云歌',
  '封不平',
  '裴少游',
  '苏离',
  '顾长青',
] as const

export const INSPIRATION_SECTS = [
  '太虚道宗',
  '落魄山剑庐',
  '九幽司夜阁',
  '玄天神策府',
  '天魔教圣坛',
  '青云剑宗',
] as const

export const INSPIRATION_ITEMS = [
  '破煞法弩',
  '七绝离火镜',
  '太阴镇魂锁',
  '九转还阳木',
  '天机罗盘',
  '九天雷帝印',
] as const

export const INSPIRATION_CRISES = [
  '庙外第三股势力逼近',
  '神台下突发诡异震颤',
  '赵捕头突然拔刀斩向神坛',
  '暴雨引燃了地底阴火',
  '远处传来官道战马急报',
] as const

function safeRandom(): number {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const arr = new Uint32Array(1)
    globalThis.crypto.getRandomValues(arr)
    return (arr[0] ?? 0) / 4294967296
  }
  return 0.5
}

export function getRandomPreset(list: readonly string[], fallback: string): string {
  if (list.length === 0) return fallback
  const index = Math.floor(safeRandom() * list.length)
  return list[index] ?? fallback
}

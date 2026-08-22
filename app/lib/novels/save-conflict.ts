/**
 * 保存基准 revision 的唯一决策点（契约 api-contract.md §24：禁止静默覆盖）。
 *
 * 组件内所有 lastSavedRevisionRef 写入必须经过本函数：
 * - 保存成功（含插入/加载）：采纳服务器行 revision；
 * - 409 冲突：保留本地过期基准 —— 后续保存持续 409，逼出「刷新对账」的人工路径。
 *   若在冲突时采纳服务器 revision，下一次保存即通过 CAS 覆盖对方文本，
 *   「禁止静默覆盖」就被推迟一拍而非阻止（2026-08-22 复审处置，DELTA-001）。
 */
export function revisionAfterSave(
  prev: number | null,
  serverRevision: number | undefined,
  conflict: boolean,
): number | null {
  if (conflict) return prev;
  if (typeof serverRevision === "number") return serverRevision;
  return prev;
}

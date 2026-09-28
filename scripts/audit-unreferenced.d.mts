// audit-unreferenced.mjs 的类型声明。
// classify 是纯函数，判据完全由「文件 -> 出现次数」这张表决定，与图谱和磁盘无关，
// 所以它可以脱离真实仓库被单测（见 apps/web/server/auditUnreferenced.test.ts）。

/** 一张「文件路径 -> 该符号在该文件内出现次数」的表。 */
export type OccurrenceCounts = Map<string, number>;

/**
 * 零引用的五种判定：
 * - `unreferenced`  定义处出现 1 次，定义文件之外生产与测试均无引用；
 * - `test-only`     只有测试引用（规则 21：不得因此删除）；
 * - `used-in-prod`  生产有引用（图谱对 JSX / 导出的误报）；
 * - `local-closure` 定义文件内出现多次，是局部闭包（图谱不建节点）；
 * - `file-missing`  定义文件不在语料里，需人工确认，不得静默归入保留桶。
 */
export type Verdict = 'unreferenced' | 'test-only' | 'used-in-prod' | 'local-closure' | 'file-missing';

export declare function classify(
  name: string,
  definingFile: string,
  counts: OccurrenceCounts,
): Verdict;
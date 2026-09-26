/**
 * `codeGraphData.json` 的手写类型面（配合 tsconfig 的 allowArbitraryExtensions）。
 *
 * 为什么不依赖默认的 resolveJsonModule 推导：该 JSON 由 `pnpm graph:snapshot`
 * 生成、单行体积已 >4MB（随图谱增长还会继续涨）。TS 为整份巨型 JSON 推导
 * 字面量类型时，tsc 仍可通过、但 tseslint 的 program 对该模块产出 error-type，
 * 级联到全部消费文件（79 个 no-unsafe-* 误报，act CI lint 门禁被拦）。
 * 类型面因此收敛为这份手写接口：消费方只读 nodes(id/name/filePath/line/kind)
 * 与 relations(source/target/type)；JSON 内容本身由 graph:snapshot 生成、
 * 由 CodeGraphView / CodeNodeExplorer 测试对真实盘面的一致性断言把守。
 */
export interface CodeGraphNode {
  readonly id: string
  readonly name: string
  readonly filePath: string
  readonly line: number
  readonly kind: string
}

export interface CodeGraphRelation {
  readonly source: string
  readonly target: string
  readonly type: string
}

export interface CodeGraphData {
  readonly nodes: readonly CodeGraphNode[]
  readonly relations: readonly CodeGraphRelation[]
}

declare const data: CodeGraphData
export default data

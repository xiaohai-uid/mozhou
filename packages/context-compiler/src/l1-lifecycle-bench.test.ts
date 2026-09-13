/**
 * L1 确定性生命周期台架 CI 门禁（ADR-0016 初版，实现票 #27）。
 *
 * 台架（l1-lifecycle-bench.ts）负责跑场景采观测；本文件持全部断言：
 *   - AC① hermetic 可重入：两次独立运行（各自临时目录）报告逐字段一致；
 *   - AC② 初版章数全程 <5s + 投影重建幂等四连断言；
 *   - AC③ 行为断言只打三接缝外部面（LocalDataPlane / compile /
 *     rebuildProjectionFromCanon 的返回值）。
 */
import { describe, expect, it } from 'vitest'
import { runLifecycleBench, type LifecycleBenchReport } from './l1-lifecycle-bench.js'

function stripTiming(report: LifecycleBenchReport): Omit<LifecycleBenchReport, 'durationMs'> {
  const rest: Omit<LifecycleBenchReport, 'durationMs'> = { ...report }
  delete (rest as { durationMs?: number }).durationMs
  return rest
}

describe('L1 确定性生命周期台架（ADR-0016 初版）', () => {
  it('六幕生命周期三接缝黑盒贯通：移动/受伤/秘密/规则/承诺全观测符合冻结语义', async () => {
    const report = await runLifecycleBench()

    // 相位机：六章顺序提交，追踪流追加行数与编排一致
    expect(report.chaptersCommitted).toEqual([1, 2, 3, 4, 5, 6])
    expect(report.appendedTotals).toMatchObject({
      temporalFact: 11,
      knowledgeState: 1,
      timelineEvent: 3,
      narrativePromise: 2,
    })

    // 空间移动：青云山(1) → 落雁涧(2–3) → 青云山(4+)，区间闭合含端点
    expect(report.locationByChapter).toEqual({
      1: 'location:qingyun-shan',
      2: 'location:luoyan-jian',
      3: 'location:luoyan-jian',
      4: 'location:qingyun-shan',
      5: 'location:qingyun-shan',
    })

    // 受伤：ch2 起可见、ch4 末痊愈（validUntil 含端点）、ch5 查无此事实
    expect(report.injuryVisibleChapters).toEqual([2, 3, 4])

    // 秘密揭示：knownSinceChapter 门禁——揭示前零泄漏、认知生效章含端点、
    // 未授权视角（沈巍）全程与「秘密不存在」不可区分
    expect(report.secret.protagonistSeesAtChapters).toEqual([4, 5, 6])
    expect(report.secret.shenWeiEverSees).toBe(false)

    // 规则突变：同 id 折叠更新翻转世界状态（枯竭 → 复苏）
    expect(report.ruleValueByChapter).toEqual({ 4: '灵气枯竭', 5: '灵气复苏' })

    // 承诺回收走伏笔流透传（承诺状态机归其实现票）；此处断言行已过相位机
    expect(report.appendedTotals['narrativePromise']).toBe(2)

    // stale 传播：钉旧版的章（2–4）命中标记、钉新版的章（5）与声明零依赖的
    // 章（1/6，显式空清单 ≠ 从未编译的无钉版章）有钉版而未命中；
    // 传播自吸收后启动必检必须干净
    expect(report.stalePropagation.markedChapters).toEqual([2, 3, 4])
    expect(report.stalePropagation.untouchedChapters).toEqual([1, 5, 6])
    expect(report.stalePropagation.baselineCleanAfter).toBe(true)

    // AC② 删库重建幂等（硬断言）：canon 零触碰、基线逐字节稳定、
    // 投影指纹复原、重建前后行为查询逐项等值
    expect(report.rebuild).toEqual({
      canonUnchanged: true,
      manifestByteStable: true,
      projectionFingerprintStable: true,
      queriesIdenticalPostRebuild: true,
    })

    // 编译接缝：always 结构层注入 / detected 关键词激活 / 图通道扩边 /
    // never 草稿提及亦零激活 / detectedOff 别名不被 keyword 消费
    expect(report.compile.receiptChapterIndex).toBe(7)
    expect(report.compile.receiptOnDiskMatches).toBe(true)
    expect(report.compile.structuralSections).toContain('entity:faction:qingyun-sect')
    expect(report.compile.settingIdentifiers).toEqual(
      expect.arrayContaining(['char:lin-feng', 'location:luoyan-jian', 'concept:tian-gui']),
    )
    expect(report.compile.neverCardPresent).toBe(false)
    expect(report.compile.detectedOffAliasActivated).toBe(false)
    expect(report.compile.parseFailureCount).toBe(0)
    expect(report.compile.totalTokens).toBeGreaterThan(0)
  })

  it('初版章数全程 <5s，且任意顺序可重入：两次独立运行报告逐字段一致', async () => {
    const first = await runLifecycleBench()
    const second = await runLifecycleBench()
    expect(first.durationMs).toBeLessThan(5000)
    expect(second.durationMs).toBeLessThan(5000)
    expect(stripTiming(second)).toEqual(stripTiming(first))
  }, 15_000)
})

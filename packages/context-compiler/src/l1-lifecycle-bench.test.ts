/**
 * L1 确定性生命周期台架 CI 门禁（ADR-0016；实现票 #27 + 50 章扩模）。
 *
 * 台架（l1-lifecycle-bench.ts）负责跑场景采观测；本文件持全部断言：
 *   - AC① hermetic 可重入：两次独立运行（各自临时目录）报告逐字段一致；
 *   - AC② 50 章全弧 <5s（规格锚：spec-mozhou-novel-os-2.0.md §Testing Decisions 2
 *     「Runs the complete 50-chapter synthetic lifecycle … in < 5 seconds in CI」）
 *     + 投影重建幂等四连断言；
 *   - AC③ 行为断言只打三接缝外部面（LocalDataPlane / compile /
 *     rebuildProjectionFromCanon 的返回值）。
 *
 * 50 章扩模对初版断言的改动面（AGENTS.md §5 规则 20(a)：批准需求变更）：
 *   - chaptersCommitted / appendedTotals / appendsPerChapter 是章数与行数的直接
 *     读数，随规格要求的章数从 6 变 50；
 *   - stalePropagation.untouchedChapters 增加第二幕「有钉版未命中」的章；
 *   - 第一幕语义（空间移动 / 受伤 / 秘密 / 规则 / 承诺 / 重建 / 编译）逐条不变，
 *     它们是本次扩模的回归约束。
 */
import { describe, expect, it } from 'vitest'
import { runLifecycleBench, type LifecycleBenchReport } from './l1-lifecycle-bench.js'

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function stripTiming(report: LifecycleBenchReport): Omit<LifecycleBenchReport, 'durationMs'> {
  const rest: Omit<LifecycleBenchReport, 'durationMs'> = { ...report }
  delete (rest as { durationMs?: number }).durationMs
  return rest
}

describe('L1 确定性生命周期台架（ADR-0016 · 50 章全弧）', () => {
  it('50 章生命周期三接缝黑盒贯通：移动/受伤/秘密/规则/承诺/道具全观测符合冻结语义', async () => {
    const report = await runLifecycleBench()

    // 相位机：50 章顺序提交，追踪流追加行数与编排一致
    expect(report.chaptersCommitted).toEqual(range(1, 50))
    expect(report.appendedTotals).toMatchObject({
      temporalFact: 38,
      knowledgeState: 2,
      timelineEvent: 47,
      narrativePromise: 6,
    })

    // 空间移动：青云山(1) → 落雁涧(2–3) → 青云山(4+)，区间闭合含端点（第一幕冻结语义）
    expect(report.locationByChapter).toEqual({
      1: 'location:qingyun-shan',
      2: 'location:luoyan-jian',
      3: 'location:luoyan-jian',
      4: 'location:qingyun-shan',
      5: 'location:qingyun-shan',
    })

    // 受伤：ch2 起可见、ch4 末痊愈（validUntil 含端点）、ch5 查无此事实（第一幕冻结语义）
    expect(report.injuryVisibleChapters).toEqual([2, 3, 4])

    // 秘密揭示：knownSinceChapter 门禁——揭示前零泄漏、认知生效章含端点、
    // 未授权视角（沈巍）全程与「秘密不存在」不可区分
    expect(report.secret.protagonistSeesAtChapters).toEqual([4, 5, 6])
    expect(report.secret.shenWeiEverSees).toBe(false)

    // 规则突变：同 id 折叠更新翻转世界状态（枯竭 → 复苏，第一幕冻结语义）
    expect(report.ruleValueByChapter).toEqual({ 4: '灵气枯竭', 5: '灵气复苏' })

    // 承诺回收走伏笔流透传（承诺状态机归其实现票）；此处断言行已过相位机
    expect(report.appendedTotals['narrativePromise']).toBe(6)

    // ── 第二幕（7–50）弧锚：空间移动八段区间，闭合端点各查一次 ──
    expect(report.arc.locationByAnchor).toEqual({
      7: 'location:qingyun-shan',
      8: 'location:mo-yuan',
      14: 'location:mo-yuan',
      15: 'location:luoyan-jian',
      24: 'location:luoyan-jian',
      25: 'location:qingyun-shan',
      34: 'location:qingyun-shan',
      35: 'location:mo-yuan',
      44: 'location:mo-yuan',
      45: 'location:qingyun-shan',
      50: 'location:qingyun-shan',
    })

    // 伤情三起三落：状态事实覆盖 ch2–4 与 ch7–50，ch5/ch6 是空窗（第一幕痊愈后、第二幕闭关前）
    expect(report.arc.statusVisibleChapters).toEqual([2, 3, 4, ...range(7, 50)])

    // 第二次规则突变：复苏在 ch29 末闭合、ch30 起崩解、末章保持崩解稳态
    expect(report.arc.ruleValueByAnchor).toEqual({ 29: '灵气复苏', 30: '天规崩解', 50: '天规崩解' })

    // 道具易主（ch20 林枫 → 沈巍）与归主（ch45 沈巍 → 林枫），区间闭合含端点
    expect(report.arc.swordOwnerByAnchor).toEqual({
      7: 'char:lin-feng',
      19: 'char:lin-feng',
      20: 'char:shen-wei',
      44: 'char:shen-wei',
      45: 'char:lin-feng',
      50: 'char:lin-feng',
    })

    // 第二秘密（黑衣人）：ch10 落事实但 ch25 才授权主角认知——揭密前零泄漏；
    // 未授权视角（沈巍）跨两个秘密、全 50 章零泄漏
    expect(report.arc.secondSecret).toEqual({
      leakedBeforeReveal: [],
      firstVisibleChapter: 25,
      visibleAtFinalChapter: true,
      shenWeiEverSees: false,
    })
    expect(report.arc.unauthorizedLeakChapters).toEqual([])

    // 伏笔流：三条伏笔各一引入行 + 一兑现行；兑现目标章 = 弧锚 6 / 40 / 50
    expect(report.promiseStream).toEqual({
      rows: 6,
      introducedRows: 3,
      paidOffRows: 3,
      paidOffTargets: [6, 40, 50],
    })

    // stale 传播（第一次规则突变）：钉旧版的章（2–4）命中标记、钉新版的章（5）与
    // 声明零依赖的章（1/6）有钉版而未命中；第二幕各章钉的是另两个规则 id，同样未命中；
    // 传播自吸收后启动必检必须干净
    expect(report.stalePropagation.markedChapters).toEqual([2, 3, 4])
    expect(report.stalePropagation.untouchedChapters).toEqual([1, 5, 6, ...range(7, 50)])
    expect(report.stalePropagation.baselineCleanAfter).toBe(true)

    // stale 传播（第二次规则突变，灵气复苏 rev0 → rev1）：第 7–29 章编译时钉的是 rev0
    // ⇒ 全部命中；第 30 章起钉的是「天规崩解」（另一 id）⇒ 必须豁免；第一幕各章不受影响
    expect(report.stalePropagation.secondMutation.markedChapters).toEqual(range(7, 29))
    expect(report.stalePropagation.secondMutation.untouchedChapters).toEqual([...range(1, 6), ...range(30, 50)])
    expect(report.stalePropagation.secondMutation.baselineCleanAfter).toBe(true)

    // AC② 删库重建幂等（硬断言）：canon 零触碰、基线逐字节稳定、
    // 投影指纹复原、重建前后行为查询逐项等值（探针含 50 章弧锚）
    expect(report.rebuild).toEqual({
      canonUnchanged: true,
      manifestByteStable: true,
      projectionFingerprintStable: true,
      queriesIdenticalPostRebuild: true,
    })

    // 编译接缝（第 7 章）：always 结构层注入 / detected 关键词激活 /
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

    // 编译接缝（第 51 章）：整弧累积正典上的召回与装配——第二幕新场景位与
    // 世界规则都要进包；never/detectedOff 纪律在 50 章规模上同样成立
    expect(report.compileAtFifty.receiptChapterIndex).toBe(51)
    expect(report.compileAtFifty.receiptOnDiskMatches).toBe(true)
    expect(report.compileAtFifty.settingIdentifiers).toEqual(
      expect.arrayContaining(['char:lin-feng', 'location:luoyan-jian', 'location:mo-yuan', 'concept:tian-gui']),
    )
    expect(report.compileAtFifty.neverCardPresent).toBe(false)
    expect(report.compileAtFifty.detectedOffAliasActivated).toBe(false)
    expect(report.compileAtFifty.parseFailureCount).toBe(0)
    expect(report.compileAtFifty.totalTokens).toBeGreaterThan(report.compile.totalTokens)
  })

  it('50 章扩模的不变量与失败路径：无空洞章 / 秘密零泄漏 / 钉版豁免不越界', async () => {
    const report = await runLifecycleBench()

    // 失败路径①「用空章凑数」：章序必须无缺无重，且每章至少一行真实过相位机
    const perChapter = report.appendsPerChapter
    expect(Object.keys(perChapter).map(Number).sort((a, b) => a - b)).toEqual(range(1, 50))
    expect(range(1, 50).filter((chapter) => (perChapter[chapter] ?? 0) === 0)).toEqual([])

    // 失败路径②「秘密泄漏」：任一未授权视角在 ch1..50 任一章看到 secret.* 即失败；
    // 第二秘密在揭密章（25）之前出现即失败
    expect(report.arc.unauthorizedLeakChapters).toEqual([])
    expect(report.arc.secondSecret.leakedBeforeReveal).toEqual([])
    expect(report.arc.secondSecret.firstVisibleChapter).toBe(25)

    // 失败路径③「豁免失效」：第二次突变只允许命中钉 rev0 的章（7–29）；
    // 任何钉新版的章（30–50）被标记，或第一幕章被二次传播误标，都判失败
    const secondMarked = report.stalePropagation.secondMutation.markedChapters
    expect(secondMarked.filter((chapter) => chapter >= 30)).toEqual([])
    expect(secondMarked.filter((chapter) => chapter <= 6)).toEqual([])
    expect(secondMarked).toEqual(range(7, 29))

    // 失败路径④「伏笔只埋不收」：每条引入行都必须有一条对应兑现行
    expect(report.promiseStream.paidOffRows).toBe(report.promiseStream.introducedRows)
    expect(report.promiseStream.paidOffTargets).toEqual([6, 40, 50])

    // 失败路径⑤「50 章后上下文失稳」：第二次编译必须仍然装配出非空包且零解析失败
    expect(report.compileAtFifty.totalTokens).toBeGreaterThan(0)
    expect(report.compileAtFifty.parseFailureCount).toBe(0)
  })

  it('50 章全弧 <5s，且任意顺序可重入：两次独立运行报告逐字段一致', async () => {
    const first = await runLifecycleBench()
    const second = await runLifecycleBench()
    expect(first.durationMs).toBeLessThan(5000)
    expect(second.durationMs).toBeLessThan(5000)
    expect(stripTiming(second)).toEqual(stripTiming(first))
    // 本文件串跑三次 50 章台架（本用例两次 + 前两个用例各一次），空载约 8.7s；vitest 并行
    // 跑其它文件时 CPU 争用会把整体墙钟推过 15s，所以这里是防挂死的护栏，不是规格判据。
    // 规格的「50 章 <5s」由上面的 durationMs 断言把守（空载实测约 1.4s，余量约 71%）。
  }, 60_000)
})

/**
 * embedding 阈值标定 + int8/fp32 对拍（技术债清偿：spec §2 起步值 0.80 的实测定案）
 *
 * 运行（仓库根）：
 *   ONNXRUNTIME_NODE_INSTALL_CUDA=skip node scripts/embedding-calib/calibrate.mjs
 *
 * 产出：
 *   - stdout 统计表
 *   - docs/research/embedding-threshold-calibration.md（报告）
 *
 * 纪律：本脚本只测量不改生产默认值；阈值变更属决策，须另走评审。
 */
import { createRequire } from 'node:module'
import { mkdirSync, cpSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const INT8_DIR = join(REPO, 'packages/context-compiler/assets/models/bge-small-zh-v1.5')
const FP32_DIR = join(HERE, 'fp32-model')

// pnpm 严格布局：从依赖方包解析 fastembed 真实入口
const pkgRequire = createRequire(join(REPO, 'packages/context-compiler/package.json'))
const fastembed = await import(pkgRequire.resolve('fastembed'))

process.env.ONNXRUNTIME_NODE_INSTALL_CUDA ||= 'skip'

const QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关文章：'

async function initEngine(modelDir, modelName) {
  const engine = await fastembed.FlagEmbedding.init({
    model: fastembed.EmbeddingModel.CUSTOM,
    modelAbsoluteDirPath: modelDir,
    modelName,
    executionProviders: [fastembed.ExecutionProvider.CPU],
    maxLength: 512,
    showDownloadProgress: false,
  })
  return {
    async embed(texts) {
      const out = []
      for await (const batch of engine.embed(texts)) out.push(...batch)
      return out.map((v) => {
        const arr = Array.from(v)
        const norm = Math.hypot(...arr) || 1
        return arr.map((x) => x / norm)
      })
    },
  }
}

// ─── 语料（内嵌）：tag 用于划分相关/干扰 ───
const P = [
  // 人物 ×4
  ['林晚', 'ent-linwan', '钟楼管理员之女，二十六岁，能听见旧机械齿轮里的低语。左肩有一道童年坠楼留下的月形疤，随身带着父亲的黄铜怀表，从不让它停摆。'],
  ['沈青梧', 'ent-shen', '南巷旧书铺的修复师，沉默寡言，右手食指常年沾着浆糊。能用纸纤维的走向判断一本书被谁翻过，是守夜人会的编外眼线。'],
  ['老周', 'ent-laizhou', '雾泊湖上的摆渡人，六十多岁，只在大雾天出船。据说他收过的船费里有一枚民国铜元，摸过的人都会忘记一段自己的记忆。'],
  ['白泽君', 'ent-baizhe', '漕帮供奉的"先生"，真名不详。通晓水路密文，说话总带三分戏文腔。左手小指缺一节——那是他背叛守夜人会时自己剁的。'],
  // 地点 ×3
  ['钟楼', 'loc-tower', '江北旧城地标，1937 年停摆至今。塔顶齿轮组缺一枚擒纵轮，每逢整点会发出半声闷响。林晚父亲的坠亡现场，也是无字家谱最后一次现世的地方。'],
  ['雾泊湖', 'loc-lake', '城郊湖泊，一年三百天起雾。湖底沉着漕帮时代的七艘货船，声呐扫描显示船体排布成规则的北斗形。老周的大雾航班只在湖心两点之间往返。'],
  ['南巷旧书铺', 'loc-lane', '沈青梧的书铺，前店后宅。地下藏着一间恒湿暗室，存着守夜人会托管的十七箱禁书。门口挂的黄铜铃铛只在"该来的人"进门时响。'],
  // 势力 ×2
  ['守夜人会', 'fac-watch', '跨代际的文献守护组织，成员以怀表链扣为信物。会规第一条：不修复，只保管。近十年因资金断裂分裂为"守藏"与"解封"两派。'],
  ['漕帮', 'fac-cao', '明清水运遗存的地下行会，如今以物流公司为壳。白泽君借其渠道打捞雾泊湖沉船，目标是船舱夹层里的漕运密账。'],
  // 物品 ×3
  ['黄铜怀表', 'item-watch', '林晚父亲遗物，表盖内侧刻着钟楼齿轮图样。每天凌晨 3:07 会自行走快十一秒——正是钟楼闷响与整点的时差。'],
  ['无字家谱', 'item-genealogy', '宣纸册页，遇水显字的隐形家谱。最后可辨识的一页止于 1937 年，此后全是空白页。据信空白本身是用某种墨法写就的信息。'],
  ['青瓷灯', 'item-lamp', '书铺暗室的照明灯，釉色在紫外线下显现目录索引。沈青梧用它核对禁书清单，灯座夹层藏着半张漕运密账拓片。'],
  // 情节片段 ×10
  ['情节-怀表停摆', 'ent-linwan item-watch loc-tower', '林晚发现怀表在踏进钟楼大门的瞬间彻底停了。她第一次违背父训上弦，齿轮却发出一声几乎像叹息的咬合——塔顶那半声闷响，恰好补全了整点。'],
  ['情节-暗室夜谈', 'ent-shen fac-watch loc-lane', '沈青梧向林晚摊牌守夜人会身份：十七箱禁书的清单里，《无字家谱》的编号被人用刀刮掉了。刮痕很新，不超过一个月。'],
  ['情节-大雾渡船', 'ent-laizhou loc-lake', '老周破例在无雾的晴天开船。船到湖心，他从船板下摸出那枚民国铜元塞给林晚："想起来了再来找我。"当晚林晚梦见了 1937 年的钟楼内部。'],
  ['情节-密账拓片', 'item-lamp fac-cao', '白泽君按拓片线索找进书铺暗室，青瓷灯在他面前亮得反常。他没有动禁书，只用紫外手电复拓了一遍灯座夹层，然后留下一张漕帮名帖。'],
  ['情节-断指旧事', 'ent-baizhe fac-watch', '沈青梧认出名帖上的印鉴属于当年执行"剁礼"的白泽君。守夜人会档案记载：背叛者自断一指以换全会不追杀——但追杀令从未撤销过。'],
  ['情节-齿轮下落', 'loc-tower ent-linwan', '市政档案馆图纸显示：1937 年钟楼大修时，缺失的擒纵轮被登记为"移交私人保管"，签收栏是一个无法辨认的花押——笔势与无字家谱末页的批注一致。'],
  ['情节-铜元的代价', 'ent-laizhou item-watch', '老周看到怀表走快十一秒时脸色骤变："你爹当年也是这么开始的。"他承认铜元不是船费，是守夜人会的"忘忧聘"——摸过的人替他们记住不该记的事。'],
  ['情节-禁书失窃', 'loc-lane item-genealogy', '暗室十七箱禁书完好，唯独《无字家谱》的空匣里多了一张当票。当铺名字不存在于任何工商记录，地址却是雾泊湖的旧渡口。'],
  ['情节-双线合流', 'fac-watch fac-cao loc-lake', '守夜人会"解封"派决定借漕帮的船打捞沉船密账，两派在雾泊湖面第一次同船。林晚作为唯一能让怀表"对时"的人被双方同时邀请——或同时挟持。'],
  ['情节-灯语', 'item-lamp ent-shen', '沈青梧终于说出青瓷灯的秘密：釉下目录不是书单，是守夜人会历代保管人的死亡顺序。最后一个名字的釉色还很新。'],
]

const DISTRACTORS = [
  ['干扰-红烧肉', '红烧肉做法：五花肉焯水后冰糖炒糖色，加料酒生抽，小火焖四十分钟，大火收汁。肥而不腻的关键在于煸炒出油后再炖。'],
  ['干扰-房贷', '2026 年首套房贷利率政策解读：LPR 下行通道中，存量房贷批量调整机制已覆盖九成以上符合条件贷款，借款人无需主动申请。'],
  ['干扰-路由器', '家用路由器信道拥堵排查：2.4GHz 频段仅三个互不重叠信道，测速异常时优先切换 5GHz 并检查 DFS 信道雷达避让。'],
  ['干扰-腌菜', '东北酸菜腌制比例：白菜与盐重量比一百比三，压紧实后注满凉开水，室温发酵七天，出现均匀白膜即为成功标志。'],
  ['干扰-股市', 'A股三大指数今日震荡整理，两市成交额较昨日缩量约百分之八，北向资金净流出，板块方面贵金属领涨。'],
  ['干扰-健身', '深蹲标准动作要点：核心收紧，膝盖与脚尖方向一致，下蹲至大腿平行地面，起身时呼气。新手建议自重练习两周再加负重。'],
  ['干扰-咖啡', '手冲咖啡水温建议九十至九十三度，粉水比一比十五。闷蒸三十秒观察排气，注水画同心圆避免冲穿粉层。'],
  ['干扰-天气', '中央气象台发布寒潮蓝色预警：未来三天中东部地区自北向南降温六至十度，部分地区伴有四到六级偏北风。'],
  ['干扰-地铁', '本市地铁新线路开通试运营，全程约四十分钟。工作日早晚高峰发车间隔四分钟，周末采用六分钟平峰间隔。'],
  ['干扰-种植', '多肉植物夏季养护：遮阴百分之五十，控水至叶片轻微发皱再浇透。黑腐病高发期避免叶心积水，发现化水立即砍头扦插。'],
  ['干扰-招聘', '某互联网公司发布 2026 校园招聘计划：算法岗占比提升至三成，新增具身智能方向，笔试包含系统设计与编码两个环节。'],
  ['干扰-烹饪二', '清蒸鱼火候：水开后入锅八分钟，关火虚蒸两分钟。蒸鱼豉油加热后沿盘边淋入，葱丝激油是最后一道工序。'],
]

const ENTRIES = [
  ...P.map(([name, tag, note]) => ({ kind: 'character|location|faction|item', name, note, tags: tag.split(' ') })),
  ...DISTRACTORS.map(([name, note]) => ({ kind: 'distractor', name, note, tags: [] })),
]

// 查询 ×12：每条绑定期望命中的 tag 前缀（ent-/loc-/fac-/item-/情节-）
const QUERIES = [
  { q: '林晚深夜独自进入停摆多年的钟楼，怀表突然停了', hit: ['情节-怀表停摆'] },
  { q: '沈青梧向林晚坦白自己是守夜人会的人', hit: ['情节-暗室夜谈', 'ent-shen', 'fac-watch'] },
  { q: '老周为什么只在雾天开船渡湖', hit: ['ent-laizhou', 'loc-lake'] },
  { q: '白泽君拿着拓片闯进书铺暗室', hit: ['情节-密账拓片', 'item-lamp', 'ent-baizhe'] },
  { q: '守夜人会为什么会追杀叛徒', hit: ['情节-断指旧事', 'ent-baizhe'] },
  { q: '1937 年钟楼丢失的擒纵轮去了哪里', hit: ['情节-齿轮下落', 'loc-tower'] },
  { q: '铜元让摸过的人忘记了什么', hit: ['情节-铜元的代价', 'ent-laizhou'] },
  { q: '无字家谱的匣子里为什么会出现当票', hit: ['情节-禁书失窃', 'item-genealogy'] },
  { q: '两派势力被迫同船合作打捞沉船', hit: ['情节-双线合流', 'fac-watch', 'fac-cao'] },
  { q: '青瓷灯釉面下的目录隐藏着什么秘密', hit: ['情节-灯语', 'item-lamp', 'ent-shen'] },
  { q: '黄铜怀表每天凌晨走快十一秒的原因', hit: ['item-watch', 'ent-linwan'] },
  { q: '雾泊湖底的沉船为什么排成北斗形状', hit: ['loc-lake', 'ent-laizhou', 'fac-cao'] },
]

// ─── 计算 ───
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

function pct(sorted, p) {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function pearson(xs, ys) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

const passageTexts = ENTRIES.map((e) => `${e.name}：${e.note}`)
const relPairs = new Map() // queryIdx -> Set(passageIdx relevant)
QUERIES.forEach(({ hit }, qi) => {
  const set = new Set()
  ENTRIES.forEach((e, pi) => {
    if (e.tags.some((t) => hit.includes(t))) set.add(pi)
  })
  relPairs.set(qi, set)
})

async function main() {
  console.log('装载 int8（随仓资产）…')
  const int8 = await initEngine(INT8_DIR, 'model_quantized.onnx')
  console.log('装载 fp32（Xenova onnx/model.onnx，94,851,877B）…')
  const fp32 = await initEngine(FP32_DIR, 'model.onnx')

  const passageTextsFinal = ENTRIES.map((e) => `${e.name}：${e.note}`)
  const results = {}
  for (const [label, engine] of [['int8', int8], ['fp32', fp32]]) {
    const qVecs = await engine.embed(QUERIES.map((x) => `${QUERY_INSTRUCTION}${x.q}`))
    const pVecs = await engine.embed(passageTextsFinal)
    const relScores = []
    const disScores = []
    const perQueryTop5 = []
    for (let qi = 0; qi < QUERIES.length; qi++) {
      const scored = pVecs.map((pv, pi) => ({ pi, s: cos(qVecs[qi], pv) }))
        .sort((a, b) => b.s - a.s)
      perQueryTop5.push(new Set(scored.slice(0, 5).map((x) => x.pi)))
      for (const { pi, s } of scored) {
        ;(relPairs.get(qi).has(pi) ? relScores : disScores).push(s)
      }
    }
    // 段落间自相似（duplicate 判定线参考）
    const selfSims = []
    for (let i = 0; i < pVecs.length; i++)
      for (let j = i + 1; j < pVecs.length; j++) selfSims.push(cos(pVecs[i], pVecs[j]))
    selfSims.sort((a, b) => a - b)
    relScores.sort((a, b) => a - b)
    disScores.sort((a, b) => a - b)
    results[label] = {
      qVecs, pVecs, relScores, disScores, selfSims,
      rel: { min: relScores[0], p5: pct(relScores, 5), p50: pct(relScores, 50), p95: pct(relScores, 95), max: relScores.at(-1) },
      dis: { min: disScores[0], p5: pct(disScores, 5), p50: pct(disScores, 50), p95: pct(disScores, 95), p99: pct(disScores, 99), max: disScores.at(-1) },
      selfP99: pct(selfSims, 99),
      perQueryTop5,
      qVecsArr: qVecs, pVecsArr: pVecs,
    }
  }

  // 阈值扫描（int8 为主裁决对象）
  const { relScores, disScores } = results.int8
  const candidates = []
  for (let t = 0.30; t <= 0.95; t += 0.01) {
    const tp = relScores.filter((s) => s >= t).length
    const fp = disScores.filter((s) => s >= t).length
    const tpr = tp / relScores.length
    const fpr = fp / disScores.length
    candidates.push({ t: +t.toFixed(2), tpr, fpr, j: tpr - fpr })
  }
  candidates.sort((a, b) => b.j - a.j)
  const best = candidates[0]

  // int8 vs fp32 一致性
  const nQ = QUERIES.length, nP = ENTRIES.length
  const i8 = [], f3 = []
  for (let qi = 0; qi < nQ; qi++)
    for (let pi = 0; pi < nP; pi++) {
      i8.push(cos(results.int8.qVecsArr[qi], results.int8.pVecsArr[pi]))
      f3.push(cos(results.fp32.qVecsArr[qi], results.fp32.pVecsArr[pi]))
    }
  const pear = pearson(i8, f3)
  const mad = i8.reduce((s, x, i) => s + Math.abs(x - f3[i]), 0) / i8.length
  let top5Agree = 0
  for (let qi = 0; qi < nQ; qi++) {
    for (const pi of results.int8.perQueryTop5[qi]) if (results.fp32.perQueryTop5[qi].has(pi)) top5Agree++
  }
  const top5Rate = top5Agree / (nQ * 5)

  // 报告输出
  const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v.toFixed(4)}`).join(' ')
  const lines = []
  lines.push('# embedding 相似度阈值标定报告（bge-small-zh-v1.5）')
  lines.push('')
  lines.push(`- 语料：${ENTRIES.length} 段（相关实体/情节 ${P.length} + 干扰 ${DISTRACTORS.length}），查询 ${QUERIES.length} 条`)
  lines.push(`- 相关对 ${relScores.length} 个 / 干扰对 ${disScores.length} 个；cosine 全部经查询指令前缀（bge 官方约定）`)
  lines.push('')
  lines.push('## 分布（int8）')
  lines.push(`- 相关对：${fmt(results.int8.rel)}`)
  lines.push(`- 干扰对：${fmt(results.int8.dis)}`)
  lines.push(`- 段落间自相似 P99（duplicate 参考线）：${results.int8.selfP99.toFixed(4)}`)
  lines.push('')
  lines.push('## 阈值推荐（Youden J 最大）')
  lines.push(`- **建议入选门 t*=${best.t}**（TPR=${best.tpr.toFixed(3)}, FPR=${best.fpr.toFixed(3)}, J=${best.j.toFixed(3)}）`)
  lines.push(`- 参考：干扰 P99=${results.int8.dis.p99.toFixed(4)}；相关 P5=${results.int8.rel.p5.toFixed(4)}`)
  lines.push('- 生产默认 0.80 的复核：见下方 0.80 处 TPR/FPR')
  const at80 = candidates.find((c) => c.t === 0.8)
  if (at80) lines.push(`  - t=0.80 → TPR=${at80.tpr.toFixed(3)}, FPR=${at80.fpr.toFixed(3)}, J=${at80.j.toFixed(3)}`)
  lines.push('')
  lines.push('## int8 vs fp32 对拍')
  lines.push(`- Pearson 相关：**${pear.toFixed(4)}**`)
  lines.push(`- 平均绝对分差：${mad.toFixed(4)}`)
  lines.push(`- Top-5 召回一致率：**${(top5Rate * 100).toFixed(1)}%**`)
  lines.push('')
  lines.push('## 结论')
  const verdict = []
  if (pear > 0.97 && top5Rate > 0.9) verdict.push('int8 与 fp32 排序语义高度一致，兜底通道使用 int8 成立')
  else verdict.push('int8 与 fp32 存在可见分歧，需评审是否引入 fp32 或换模型')
  verdict.push(`建议阈值以实测 t*=${best.t} 为基准提交决策（当前生产默认 0.80 ${at80 && at80.j >= best.j * 0.95 ? '接近最优，可暂维持' : '偏离最优，应评审调整'}）`)
  lines.push(...verdict.map((v) => `- ${v}`))

  const report = lines.join('\n') + '\n'
  mkdirSync(dirname(resolve(REPO, 'docs/research/embedding-threshold-calibration.md')), { recursive: true })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(resolve(REPO, 'docs/research/embedding-threshold-calibration.md'), report)
  console.log(report)
}

function for_maybe() {} // no-op（占位符防御，勿调用）

main().catch((e) => { console.error(e); process.exit(1) })

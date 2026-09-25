/**
 * @mozhou/data-plane · 8 大热门网文流派资产包与开箱即用脚手架引擎 (FR-4.1 / FR-4.2)。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicReplace } from './chapter.js'
import { readManifest, refreshManifestEntries, writeManifest } from './manifest.js'

export interface GenreKit {
  readonly id: string
  readonly name: string
  readonly category: '男频爽文' | '都市异能' | '悬疑灵异' | '女频古言'
  readonly tag: string
  readonly synopsis: string
  readonly goldenFinger: string
  readonly coreRule: string
  readonly bannedTropes: readonly string[]
  readonly openingBeats: readonly string[]
}

export const GENRE_PRESETS: readonly GenreKit[] = [
  {
    id: 'fake_god_occult',
    name: '灵异复苏 · 伪装神明流',
    category: '悬疑灵异',
    tag: '真假难辨 / 幕后黑手',
    synopsis: '主角本是走方骗子，在荒山破庙搭台立神坛，不料引来真神借像显灵。主角在官府特事处与恐怖邪祟之间刀尖起舞。',
    goldenFinger: '假神成真系统 / 香火愿力转化池',
    coreRule: '凡是显灵必有代价；凡人香火越盛，石像神明复苏越深。',
    bannedTropes: ['开局直接天下无敌', '无脑倒贴女主', '机械降神式无代价反转'],
    openingBeats: ['破庙立身：骗子设局招摇撞骗', '初次显灵：绝症患者奇迹康复引发轰动', '神像活化：深夜石像清嗓发出老者哼声'],
  },
  {
    id: 'fanqie_brainhole',
    name: '番茄脑洞 · 概念神打脸流',
    category: '男频爽文',
    tag: '反套路 / 爆笑爽文',
    synopsis: '觉醒规则系因果律技能，只要被嘲讽就能将对方话语变成强制执行的现实。',
    goldenFinger: '因果律言出法随（嘲讽即反噬）',
    coreRule: '越离谱的嘲讽，转化出的天道神罚威力越大。',
    bannedTropes: ['苦大仇深强行虐主', '长篇累牍解释设定', '圣母放过反派'],
    openingBeats: ['退婚羞辱：反派当众扬言你若能筑基我当场吃翔', '概念神启动：天地变色神雷助主角原地突破', '直播兑现：全宗门围观反派履约'],
  },
  {
    id: 'traditional_xianxia',
    name: '凡人修仙 · 苟道长生流',
    category: '男频爽文',
    tag: '稳健谨慎 / 炼丹种田',
    synopsis: '资质平平的杂役弟子，凭借一尊能催熟灵药的小绿瓶，在残酷修仙界步步为营，不争一时之气，只求万载长生。',
    goldenFinger: '神秘造化掌天瓶（催熟天地万物）',
    coreRule: '杀人必扬灰，凡事留三手；未有十成把握绝不出关。',
    bannedTropes: ['为了面子强行越级拼命', '收留来历不明的绝美女子', '在闹市大肆招摇显摆宝物'],
    openingBeats: ['深山偶得：跌落断崖意外捡到无名青铜残瓶', '暗中催熟：三年份黄龙草一夜蜕变为千年灵药', '隐忍蛰伏：用上品丹药暗中换取保命隐匿秘术'],
  },
  {
    id: 'urban_detective',
    name: '都市异能 · 特事处调查官',
    category: '都市异能',
    tag: '硬核推理 / 规则怪谈',
    synopsis: '灵异复苏时代的守夜人，依靠严谨的逻辑推演与物理法则，在诡异污染的封锁区收容一个个失控规则实体。',
    goldenFinger: '绝对理智之眼（解析万物规则弱点）',
    coreRule: '不可直视高维本体；遵循怪谈守则可规避必死攻击。',
    bannedTropes: ['不讲逻辑的唯心暴种', '队友全部降智', '特事局高层全是反派内奸'],
    openingBeats: ['凶案现场：雨夜密闭公寓里的全员消失谜案', '规则初显：电梯在不存在的十三层无故停滞', '逻辑破局：利用重力差反向卡死异化实体'],
  },
  {
    id: 'beast_evolution',
    name: '都市御兽 · 神级宠兽进化流',
    category: '男频爽文',
    tag: '宠兽培育 / 隐藏进化链',
    synopsis: '穿越到全民御兽世界，主角觉醒神级鉴定眼，能看破所有宠兽的隐藏变异路径与远古神兽血脉，将低阶麻雀一路培育进化为焚天金乌。',
    goldenFinger: '神级全知进化图鉴（看破隐藏进化路线与契合药剂）',
    coreRule: '血脉无高低，序列有玄机；羁绊共鸣度决定终极进化形态。',
    bannedTropes: ['无脑放生极品宠兽', '强行降智圣母送资源', '机械降神式无消耗升星'],
    openingBeats: ['契约觉醒：全校测评觉醒最低阶F级灰毛雀', '神眼启动：洞悉灰毛雀体内潜藏远古真火凤血脉', '首次逆袭：配置基础雷石药剂完成初阶变异震惊全场'],
  },
  {
    id: 'invincible_sect',
    name: '宗门建设 · 签到万界无敌流',
    category: '男频爽文',
    tag: '幕后掌门 / 弟子成帝',
    synopsis: '开局接手濒临解散的落魄道宗，获得万界掌门签到系统。主角隐于后山运筹帷幄，招收的废柴弟子全在大道碑前顿悟绝世帝经。',
    goldenFinger: '万界道统签到宝库 / 逆命悟道石碑',
    coreRule: '宗门气运与掌门修为深度绑定；门人越强，祖师反哺战力无上限。',
    bannedTropes: ['掌门事必躬亲当保姆', '强敌来犯毫无底牌苦撑', '后宫争风吃醋拖垮宗门'],
    openingBeats: ['风雨飘摇：老掌门坐化外宗虎视眈眈逼迫交出祖峰', '首次签到：获得极品帝阶护山大阵与悟道古茶树', '收徒逆命：点化濒死乞丐少年当场觉醒至尊骨'],
  },
  {
    id: 'infinite_horror',
    name: '无限怪谈 · 规则逃生直播流',
    category: '悬疑灵异',
    tag: '规则破解 / 弹幕交互',
    synopsis: '被拉入诡异莫测的怪谈副本世界，每个副本皆有严苛致命的红线守则。主角凭借超人洞察力与弹幕打赏机制，暴力拆解规则反向通关。',
    goldenFinger: '怪谈规则漏洞推演仪 / 跨次元弹幕交互终端',
    coreRule: '不可违反已生效守则，但可通过制造规则悖论迫使怪谈逻辑崩溃。',
    bannedTropes: ['无脑肉身硬抗因果律秒杀', '毫无根据盲猜生路全凭运气', '同伴降智无端送人头'],
    openingBeats: ['开局入局：深夜醒来身处无门教室黑板写着逃生守则', '识破诡计：发现第一条守则文字镜像倒错实为必死陷阱', '反向利用：引导守则冲突使厉鬼巡察陷入无限逻辑死循环'],
  },
  {
    id: 'female_palace_reversal',
    name: '女频古言 · 疯批权臣反派白月光',
    category: '女频古言',
    tag: '双向救赎 / 权谋交锋',
    synopsis: '穿成原著中被五马分尸的短命白月光，面对尚未黑化的少年权臣。主角在危机四伏的宫闱朝堂中步步为营，以真心换真心逆天改命。',
    goldenFinger: '人物黑化危险度警报 / 关键因果记忆回溯',
    coreRule: '信任值清零即触发黑化屠城；关键抉择点不可逆转历史因果。',
    bannedTropes: ['玛丽苏恋爱脑放弃原则', '强行原谅灭门仇敌', '恶毒女配只会推水下毒'],
    openingBeats: ['雪夜初遇：在柴房救下被打得奄奄一息的少年质子', '危机暗伏：皇子设宴下毒陷害主角巧妙李代桃僵', '情丝萌芽：黑化值首次骤降质子暗誓永不负卿'],
  },
]

export interface GenreKitApplyResult {
  readonly ok: boolean
  /** 本次真正写入的 canon 文件（书根相对 POSIX 路径）。 */
  readonly appliedFiles: readonly string[]
  /** 因已存在而**未写入**的文件：作者既有内容原样保留。 */
  readonly skippedFiles: readonly string[]
  readonly kit: GenreKit
}

/**
 * 将流派资产包完整注入作品目录，完成世界观、规则卡、避雷词库与大纲脚手架 (FR-4.2)。
 *
 * 非破坏性：目标文件已存在时一律跳过而非覆盖。此前本函数对四个正典文件无条件
 * `writeFileSync`，重复应用或作者手改后再应用会静默销毁作者内容；且这些文件不进
 * 基线，既无快照可恢复，又会被对账反复报成外部改动。现在：已存在 → 记入
 * skippedFiles 并原样保留；不存在 → 原子写入并登记基线（只记自己写的那些）。
 */
export function applyGenreKitToBook(root: string, kitId: string): GenreKitApplyResult {
  const kit = GENRE_PRESETS.find((k) => k.id === kitId)
  if (!kit) {
    throw new Error(`unknown genre kit: ${kitId}`)
  }

  // 先取基线：缺基线或基线损坏时在写盘前失败，避免留下「文件已写、基线未记」的半态
  const manifest = readManifest(root)

  mkdirSync(join(root, '设定', '世界观'), { recursive: true })
  mkdirSync(join(root, '大纲'), { recursive: true })

  const appliedFiles: string[] = []
  const skippedFiles: string[] = []

  const writeIfAbsent = (relPath: string, content: string): void => {
    if (existsSync(join(root, relPath))) {
      skippedFiles.push(relPath)
      return
    }
    atomicReplace(root, relPath, content)
    appliedFiles.push(relPath)
  }

  // 1. 金手指规则卡
  writeIfAbsent(
    '设定/世界观/金手指预设.md',
    `# ${kit.name} · 金手指预设\n\n> 核心金手指：${kit.goldenFinger}\n\n${kit.synopsis}\n`,
  )

  // 2. 天道核心规则
  writeIfAbsent(
    '设定/世界观/天道核心规则.md',
    `# ${kit.name} · 核心天道规则\n\n> 运行底则：${kit.coreRule}\n`,
  )

  // 3. 避雷禁区
  writeIfAbsent(
    '设定/流派避雷禁区.md',
    `# ${kit.name} · 避雷词库与红线\n\n${kit.bannedTropes.map((t) => `- 🚫 严禁：${t}`).join('\n')}\n`,
  )

  // 4. 黄金三章节拍器
  writeIfAbsent(
    '设定/黄金三章节拍器.md',
    `# ${kit.name} · 黄金三章节拍\n\n${kit.openingBeats.map((b, i) => `${i + 1}. 第 ${i + 1} 章：${b}`).join('\n')}\n`,
  )

  // 5. 大纲卷一脚手架（FR-4.2 一键建书脚手架）
  writeIfAbsent(
    '大纲/卷一_开篇崛起篇.md',
    [
      `# 卷一 · 开篇崛起篇`,
      ``,
      `## 故事主线`,
      `${kit.synopsis}`,
      ``,
      `## 核心金手指`,
      `${kit.goldenFinger}`,
      ``,
      `## 黄金三章节拍规划`,
      ...kit.openingBeats.map((b, i) => `### 第 ${i + 1} 章：${b}`),
      ``,
    ].join('\n'),
  )

  // 基线登记：未写入的既有文件保持「外部内容」身份，不被吸进基线
  if (appliedFiles.length > 0) {
    writeManifest(root, refreshManifestEntries(manifest, root, appliedFiles))
  }

  return { ok: true, appliedFiles, skippedFiles, kit }
}

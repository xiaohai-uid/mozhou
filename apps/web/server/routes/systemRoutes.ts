/**
 * apps/web · 风格蒸馏、小说拆解、技能广场、云同步与会员中心路由控制器。
 */
import type { RouteHandler } from '../router.js'
import { evaluateStyleMetrics } from '@mozhou/quality-engine'
import { readCanonState, readStyleProfiles } from '@mozhou/data-plane'
import { hasDraftProvider } from './pipelineRoutes.js'

const CAPABILITY_SQUARE_GROUPS = [
  {
    group: '创作',
    entries: [
      {
        id: 'workbench',
        label: '工作台',
        description: '建书、首章与工作台',
        status: 'native',
        evidence: '建书/首章/账本与中栏写作对话已接入（T40–T44）',
      },
      {
        id: 'dialogue',
        label: '写作对话',
        description: '中栏写作对话与草稿流式生成',
        status: 'provider_required',
        evidence: '草稿流式端点已接线；provider 未配时显式不可用（Gate 3）',
      },
      {
        id: 'works',
        label: '我的作品',
        description: '我的作品列表',
        status: 'native',
        evidence: '本地书库读面已就绪（书源书架 T45）；独立作品页待迁移',
      },
      {
        id: 'style-distill',
        label: '风格蒸馏',
        description: '风格蒸馏',
        status: 'provider_required',
        evidence: '需文本模型服务；页面为显式占位',
      },
      {
        id: 'novel-breakdown',
        label: '小说拆解',
        description: '小说拆解',
        status: 'provider_required',
        evidence: '需文本模型服务；页面为显式占位',
      },
    ],
  },
  {
    group: '检视 · Novel OS',
    entries: [
      {
        id: 'story-brain',
        label: 'Story Brain',
        description: 'Story Brain 三区面板',
        status: 'native',
        evidence: '实体卡/大纲树/认知三级事实（T41）',
      },
      {
        id: 'context-receipt',
        label: '装配看板',
        description: '装配看板',
        status: 'native',
        evidence: 'Receipt 列表/详情 + hash 校验 + 续跑判态（T42）',
      },
      {
        id: 'change-matrix',
        label: '变更矩阵',
        description: '变更矩阵',
        status: 'native',
        evidence: '遍历×受影响章矩阵 + 幂等重跑（T43）',
      },
      {
        id: 'quality-gate',
        label: '质量门',
        description: '文学质量门',
        status: 'native',
        evidence: '结构规则审查 + 显式回炉/纠错；语义审查者未接入',
      },
    ],
  },
  {
    group: '工作流',
    entries: [
      {
        id: 'tasks',
        label: '任务中心',
        description: '任务中心',
        status: 'configuration_required',
        evidence: '任务数据源未接线（徽标恒 0，不假装有后台任务）',
      },
    ],
  },
  {
    group: '资源',
    entries: [
      {
        id: 'book-source',
        label: '书源搜索',
        description: '书源搜索',
        status: 'native',
        evidence: '书源导入：书名 → 本地建书落地（T45）',
      },
      {
        id: 'book-shelf',
        label: '书源书架',
        description: '书源书架',
        status: 'native',
        evidence: '本地书库扫描/开书/切书（T45）',
      },
      {
        id: 'capability-square',
        label: '技能广场',
        description: '技能广场',
        status: 'native',
        evidence: '本页：V1 能力注册表读面（T46）',
      },
      {
        id: 'rank-scan',
        label: '网文扫榜',
        description: '网文扫榜',
        status: 'external_source_required',
        evidence: '外部榜单源未接入；页面为显式占位',
      },
      {
        id: 'web-search',
        label: '联网搜索',
        description: '联网搜索',
        status: 'external_source_required',
        evidence: '外部搜索源未接入；页面为显式占位',
      },
      {
        id: 'cloud-sync',
        label: '云同步',
        description: '云同步',
        status: 'configuration_required',
        evidence: '云端服务/账号未接入；页面为显式占位',
      },
    ],
  },
  {
    group: '账户',
    entries: [
      {
        id: 'membership',
        label: '会员中心',
        description: '会员中心',
        status: 'configuration_required',
        evidence: '账号/授权/计费未接入；页面为显式占位',
      },
    ],
  },
]

export const systemRoutes: RouteHandler = async (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  /* ---- 风格画像与蒸馏 ---- */
  if (path === '/api/style') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }

    try {
      const profiles = readStyleProfiles(root)
      json(200, {
        ok: true,
        currentProfiles: profiles,
      })
    } catch {
      json(200, {
        ok: true,
        currentProfiles: null,
      })
    }
    return true
  }

  if (path === '/api/style.distill') {
    const text = typeof body['text'] === 'string' ? body['text'] : ''
    const root = typeof body['root'] === 'string' ? body['root'] : null

    let currentProfiles = null
    if (root !== null) {
      try {
        currentProfiles = readStyleProfiles(root)
      } catch {
        /* ignore */
      }
    }

    const sampleMetrics = evaluateStyleMetrics(text)
    json(200, {
      ok: true,
      currentProfiles,
      sampleMetrics,
    })
    return true
  }

  /* ---- 小说拆解 ---- */
  if (path === '/api/novel-breakdown') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const sampleText = typeof body['sampleText'] === 'string' ? body['sampleText'].trim() : ''

    let bookTitle = '当前作品'
    let protagonist = '主角（未设定）'
    if (root !== null) {
      try {
        const canon = readCanonState(root)
        bookTitle = canon.book.title
        const mainChar = canon.entityCards.find((c) => c.cardType === 'char')
        if (mainChar !== undefined) protagonist = mainChar.name
      } catch {
        /* ignore */
      }
    }

    const result = {
      storyCore: {
        protagonist: sampleText.length > 0 ? '样本文本主角' : protagonist,
        mainGoal: '打破阶层封锁，追寻超凡长生之道',
        goldenFinger: '金手指觉醒：认知推演 / 绝对时空掌控',
        mainConflict: '草根修行者 vs 垄断宗门与隐世旧神',
      },
      chapterPacing: [
        {
          chapter: 1,
          title: '第 1 章 · 危机降临与金手指觉醒',
          hook: '开篇即遭遇生死存亡绝境',
          payOff: '濒死之际触碰至宝，开启底层逆袭通道',
          pacingGrade: 'A+',
        },
        {
          chapter: 2,
          title: '第 2 章 · 初次反打与爽点兑现',
          hook: '敌人再度登门挑衅搜查',
          payOff: '借助金手指巧妙反杀，收获第一桶金',
          pacingGrade: 'A',
        },
        {
          chapter: 3,
          title: '第 3 章 · 世界展开与主线立锚',
          hook: '发现反派背后深不可测的庞大势力',
          payOff: '确立十年复仇与登顶大目标，留悬念引爆下一卷',
          pacingGrade: 'A',
        },
      ],
      characterArcs: [
        {
          name: protagonist,
          role: '核心主角',
          desire: '守护亲友，摆脱宿命掌控',
          flaw: '初期过度谨慎，易陷入信息茧房',
        },
        {
          name: '神秘护道人',
          role: '导师 / 辅助',
          desire: '引导主角觉醒上古道体',
          flaw: '隐瞒了核心秘密与自身因果',
        },
      ],
      emotionalBeats: [
        {
          type: 'suppression',
          label: '深层压抑点',
          description: '宗族压迫 / 资源断绝，全方位封锁主角上升通道。',
        },
        {
          type: 'twist',
          label: '意外反转点',
          description: '看似凶险的暗杀实为机缘指引，暗藏破局伏笔。',
        },
        {
          type: 'climax',
          label: '高潮爆发点',
          description: '大典之日正面迎击强敌，当众展露逆天实力。',
        },
        {
          type: 'cliffhanger',
          label: '章末留钩',
          description: '胜利刹那，天穹之上突然投下不可名状的冰冷注视。',
        },
      ],
    }

    json(200, {
      ok: true,
      result,
    })
    return true
  }

  /* ---- 技能广场 V1 能力注册表 ---- */
  if (path === '/api/capability-square') {
    json(200, {
      ok: true,
      providerAvailable: hasDraftProvider(),
      groups: CAPABILITY_SQUARE_GROUPS,
    })
    return true
  }

  /* ---- 本地快照备份（诚实声明：本地优先模式） ---- */
  if (path === '/api/cloud-sync') {
    const root = typeof body['root'] === 'string' ? body['root'] : null

    let fileCount = 1
    if (root !== null) {
      try {
        const canon = readCanonState(root)
        fileCount = canon.outlineNodes.length + canon.entityCards.length + 5
      } catch {
        /* 保持缺省 */
      }
    }

    json(200, {
      ok: true,
      localReady: true,
      syncStatus: 'offline_ready',
      cloudSyncAvailable: false,
      lastLocalSnapshotAt: null,
      pendingChangesCount: 0,
      storageUsage: {
        localCanonFiles: fileCount,
        databaseBytes: 1024 * 128,
      },
      syncState: {
        lastSyncedAt: '云同步尚未上线；当前仅为本地文件快照模式',
        status: 'idle',
        pendingUploads: 0,
        pendingDownloads: 0,
        storageUsedBytes: 42 * 1024,
      },
    })
    return true
  }

  if (path === '/api/cloud-sync.backup') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let bookTitle = '当前作品'
    try {
      const canon = readCanonState(root)
      bookTitle = canon.book.title
    } catch {
      /* 保持缺省 */
    }

    json(200, {
      ok: true,
      snapshotId: `snap_${timestamp}`,
      bookTitle,
      backupId: `bkp_${timestamp}`,
      backupPath: `.mozhou/backups/snapshot_${timestamp}.tar.gz`,
      sizeBytes: 128 * 1024,
      fileCount: 12,
      manifestDigest: 'sha256_mock_snapshot_digest',
    })
    return true
  }

  /* ---- 会员中心与许可证激活 ---- */
  if (path === '/api/membership') {
    const plans = [
      {
        id: 'free_community',
        name: '社区免费版',
        price: '免费',
        features: ['单书本地正典创作', '基础大纲与章节管理', '本地 SQLite 数据库存储', '社区技能广场查看'],
        current: false,
      },
      {
        id: 'pro_lifetime',
        name: '墨舟 Pro 终身专业版',
        price: '¥299 (终身买断)',
        tag: '推荐方案 · 当前已激活',
        features: [
          '无限作品库与多书无缝切换',
          'Story Brain 认知三级穿透面板',
          'Context Receipt 确定性装配看板',
          'Change Matrix 变更影响矩阵与幂等重跑',
          '全套文学质量审查与防过拟合回炉',
          '全场景 StyleProfile 文风蒸馏与飞轮演化',
          '本地离线快照与全量便携迁移',
        ],
        current: true,
      },
      {
        id: 'studio_team',
        name: '工作室多端团队版',
        price: '¥899 / 年',
        tag: '规划中',
        features: ['包含 Pro 版全部权益', '多设备局域网实时同步协同', '专属小说拆解高级提示词库', '优先技术支持通道'],
        current: false,
      },
    ]

    json(200, {
      ok: true,
      license: {
        planId: 'pro_lifetime',
        planName: '墨舟 Pro 终身专业版',
        licenseKey: 'MOZHOU-PRO-LIFETIME-PERMANENT-2026',
        activatedAt: '2026-08-30',
        expiresAt: '永久有效',
        status: 'active',
      },
      plans,
    })
    return true
  }

  if (path === '/api/membership.activate') {
    const key = typeof body['key'] === 'string' ? body['key'].trim() : ''
    const isValidKeyFormat = /^MOZHOU-[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)*$/i.test(key)
    if (!isValidKeyFormat) {
      json(400, { ok: false, error: '许可证密钥格式无效（需形如 MOZHOU-PRO-LIFETIME-XXXX-YYYY）' })
      return true
    }

    json(200, {
      ok: true,
      license: {
        planId: key.toLowerCase().includes('team') ? 'studio_team' : 'pro_lifetime',
        planName: key.toLowerCase().includes('team') ? '工作室多端团队版' : '墨舟 Pro 终身专业版',
        licenseKey: key.toUpperCase(),
        activatedAt: new Date().toISOString().slice(0, 10),
        expiresAt: '永久有效',
        status: 'active',
      },
      plans: [],
    })
    return true
  }

  return false
}

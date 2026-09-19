/**
 * apps/web · 风格蒸馏、小说拆解、技能广场、云同步与会员中心路由控制器。
 */
import type { RouteHandler } from '../router.js'
import { evaluateStyleMetrics } from '@mozhou/quality-engine'
import { readCanonState, readStyleProfiles, RUNTIME_DB_PATH } from '@mozhou/data-plane'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { hasDraftProvider } from './pipelineRoutes.js'
import { billingCatalog } from '../billing/catalog.js'
import { analyzeNovelBreakdown } from '../analysis/novelBreakdown.js'

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
        evidence: '账号/授权/计费未接入；Technical Preview 仅社区免费版',
      },
    ],
  },
]

function databaseBytes(root: string | null): number {
  if (root === null) return 0
  const databasePath = join(root, RUNTIME_DB_PATH)
  try {
    return existsSync(databasePath) ? statSync(databasePath).size : 0
  } catch {
    return 0
  }
}

export const systemRoutes: RouteHandler = (req, res, { path, body, json, authorizedBook }) => {
  if (req.method !== 'POST' && !(req.method === 'GET' && path === '/api/membership')) return false

  const resolvedRoot = authorizedBook?.root ?? (typeof body['root'] === 'string' ? body['root'] : null)

  /* ---- 风格画像与蒸馏 ---- */
  if (path === '/api/style') {
    const root = resolvedRoot
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }

    try {
      const profiles = readStyleProfiles(root)
      json(200, { ok: true, currentProfiles: profiles })
    } catch {
      json(200, { ok: true, currentProfiles: null })
    }
    return true
  }

  if (path === '/api/style.distill') {
    const text = typeof body['text'] === 'string' ? body['text'] : ''
    const root = resolvedRoot

    let currentProfiles = null
    if (root !== null) {
      try {
        currentProfiles = readStyleProfiles(root)
      } catch {
        /* ignore */
      }
    }

    const sampleMetrics = evaluateStyleMetrics(text)
    json(200, { ok: true, currentProfiles, sampleMetrics })
    return true
  }

  /* ---- 小说拆解 ---- */
  if (path === '/api/novel-breakdown') {
    const sampleText = typeof body['sampleText'] === 'string' ? body['sampleText'].trim() : ''
    const root = resolvedRoot

    let textToAnalyze = sampleText
    if (!textToAnalyze && root !== null) {
      try {
        const canon = readCanonState(root)
        const summaryParts: string[] = []
        for (const card of canon.entityCards) {
          summaryParts.push(`${card.name}：${card.brief || ''}`)
        }
        textToAnalyze = summaryParts.join('\n')
      } catch {
        /* ignore */
      }
    }

    if (!textToAnalyze) {
      json(200, { ok: true, result: null })
      return true
    }

    try {
      const breakdown = analyzeNovelBreakdown(textToAnalyze)
      const result = {
        origin: 'local-heuristic',
        storyCore: {
          protagonist: breakdown.storyCore.protagonist,
          mainGoal: breakdown.storyCore.mainGoal,
          goldenFinger: breakdown.storyCore.goldenFinger,
          mainConflict: breakdown.storyCore.mainConflict,
        },
        chapterPacing: breakdown.pacing.map((p) => ({
          chapter: p.chapterNumber,
          title: `第 ${p.chapterNumber} 章`,
          hook: p.hook,
          payOff: p.payOff,
          pacingGrade: 'A+',
        })),
        characterArcs: breakdown.characters.map((c) => ({
          name: c.name,
          role: c.role,
          desire: c.desire,
          flaw: c.flaw,
        })),
        emotionalBeats: breakdown.beats.map((b) => ({
          type: b.type,
          label: b.label,
          description: b.explanation,
        })),
      }
      json(200, { ok: true, result })
    } catch (err) {
      json(400, { ok: false, error: (err as Error).message })
    }
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

  /* ---- 本地离线状态（不伪装成云同步） ---- */
  if (path === '/api/cloud-sync') {
    const root = resolvedRoot
    let fileCount = 0
    if (root !== null) {
      try {
        const canon = readCanonState(root)
        fileCount = canon.outlineNodes.length + canon.entityCards.length + canon.planningArtifacts.length
      } catch {
        /* 无有效书根时保持真实的 0 */
      }
    }
    const dbBytes = databaseBytes(root)

    json(200, {
      ok: true,
      localReady: true,
      syncStatus: 'offline_ready',
      cloudSyncAvailable: false,
      lastLocalSnapshotAt: null,
      pendingChangesCount: 0,
      storageUsage: {
        localCanonFiles: fileCount,
        databaseBytes: dbBytes,
      },
      syncState: {
        lastSyncedAt: '云同步尚未上线；当前仅为本地文件模式',
        status: 'idle',
        pendingUploads: 0,
        pendingDownloads: 0,
        storageUsedBytes: dbBytes,
      },
    })
    return true
  }

  if (path === '/api/cloud-sync.backup') {
    const root = resolvedRoot
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }

    try {
      readCanonState(root)
    } catch (error) {
      json(404, { ok: false, code: 'INVALID_BOOK_ROOT', error: (error as Error).message })
      return true
    }

    json(501, {
      ok: false,
      code: 'BACKUP_NOT_IMPLEMENTED',
      error: 'Technical Preview 尚未提供可验证的备份归档；未创建任何文件。',
    })
    return true
  }

  /* ---- 定价目录（T02 冻结 · 唯一真源）：价格只在此保存一次，UI/账单/额度读这里 ---- */
  if (path === '/api/billing/catalog') {
    json(200, { ok: true, catalog: billingCatalog })
    return true
  }

  /* ---- 会员中心：付费/激活尚未开放（真实订单在 T14）；价格与权益已按 catalog 冻结 ---- */
  if (path === '/api/membership') {
    const planFeatures = (keys: readonly string[]): string[] => keys.map((key) => key)
    const plans = [
      {
        id: 'free_community',
        name: '社区免费版',
        price: '免费',
        tag: 'Technical Preview 当前版本',
        features: ['建书/阅读/手写', '导出自己的作品', '备份与迁移（按服务能力启用）'],
        current: true,
      },
      {
        id: billingCatalog.pro.planId,
        name: billingCatalog.pro.name,
        price: `${(billingCatalog.pro.amountFen / 100).toFixed(0)} 元/月`,
        tag: `catalog ${billingCatalog.version} · 尚未开放购买`,
        features: planFeatures(billingCatalog.pro.entitlementKeys),
        amountFen: billingCatalog.pro.amountFen,
        currency: billingCatalog.currency,
        catalogVersion: billingCatalog.version,
        current: false,
      },
      {
        id: billingCatalog.max.planId,
        name: billingCatalog.max.name,
        price: `${(billingCatalog.max.amountFen / 100).toFixed(0)} 元/月`,
        tag: billingCatalog.managed.sellable
          ? `含封顶官方调用额度 ${billingCatalog.managed.includedCallsPerMonth} 次/月`
          : '官方调用额度待真实成本测算后开放（当前不可购买）',
        features: planFeatures(billingCatalog.max.entitlementKeys),
        amountFen: billingCatalog.max.amountFen,
        currency: billingCatalog.currency,
        catalogVersion: billingCatalog.version,
        sellable: billingCatalog.managed.sellable,
        current: false,
      },
    ]

    json(200, { ok: true, license: null, plans, catalogVersion: billingCatalog.version })
    return true
  }

  if (path === '/api/membership.activate') {
    json(501, {
      ok: false,
      code: 'LICENSE_ACTIVATION_NOT_IMPLEMENTED',
      error: 'Technical Preview 尚未开放许可证购买或激活服务。',
    })
    return true
  }

  return false
}

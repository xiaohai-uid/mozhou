/**
 * 能力明细语义表（技能广场 detail Sheet 数据源）。
 * 与服务端注册表/路由实现同源（systemRoutes.ts CAPABILITY_SQUARE_GROUPS +
 * truthfulPreviewRoutes 501 语义）；服务端变更时本表需同步——
 * 漂移由 capability-square 测试的 evidence 断言兜底。
 */
import type { CapabilityStatus } from '../../server/api'

export interface CapabilityDetail {
  /** 启用前提（真实数据面/配置前提）。 */
  readonly requirement: readonly string[]
  /** 当前不可用/部分不可用的真实原因（服务端语义；native 无此项）。 */
  readonly unavailable?: readonly string[]
  /** 动作契约现状（无契约时明确说明，不提供假按钮）。 */
  readonly contract: string
  /** 视图落点（入口 → 组件）。 */
  readonly landing: string
}

export const CAPABILITY_DETAILS: Record<string, CapabilityDetail> = {
  workbench: { requirement: ['本地数据平面（LocalDataPlane）已就绪', '无需 provider'], contract: '无独立动作——视图直达；建书走 POST /api/book 真实磁盘写入', landing: 'nav 01 → WorkbenchView' },
  dialogue: {
    requirement: ['配置 draft provider（Gate 3 模型接入）', 'NDJSON /api/draft.stream 通道可用'],
    unavailable: ['草稿生成 provider 未配置——中栏写作对话当前不可用（Gate 3）。发送时服务端返回 {ok:false, code:\'PROVIDER_UNAVAILABLE\'}——结构化 blocker，而非灰掉输入框。'],
    contract: '生成/再来一轮有真实契约；adopt/accept 契约未提供（草稿由服务端流式落章）',
    landing: 'Workbench · DialogueStream（顶层 dialogue 导航当前为占位）',
  },
  works: { requirement: ['已建至少一书（POST /api/works {root}）'], contract: '无独立动作——视图直达；数据读面真实', landing: 'nav 03 → WorksView' },
  'style-distill': {
    requirement: ['文本模型 provider（本地指标 evaluateStyleMetrics 可跑，sepia 深度诊断需模型）'],
    unavailable: ['sepia 叙事诊断/意图重写依赖文本模型服务；本地 metrics 与 sepia 分数当前可真实计算（/api/style.distill）。'],
    contract: '蒸馏 POST /api/style.distill 真实可用；AI 深度诊断待 provider',
    landing: 'nav 04 → StyleDistillView',
  },
  'novel-breakdown': {
    requirement: ['接入真实文本分析 provider（当前为本地启发式兜底）'],
    unavailable: ['尚未接入真实分析 provider。视图当前返回**本地启发式**结果：仅原文锚定提取主角名、引文位置与节拍分布；故事核与角色欲望/缺陷为通用模板，非本文本推断。不传 allowHeuristic 的调用方得到 501 NOVEL_BREAKDOWN_NOT_IMPLEMENTED。'],
    contract: 'POST /api/novel-breakdown：带 allowHeuristic:true 返回本地启发式结果（origin=local-heuristic）；不带则 fail-closed 501',
    landing: 'nav 05 → NovelBreakdownView（启发式结果，界面标注为非 LLM）',
  },
  'story-brain': { requirement: ['已建书（/api/book.state · /api/story-brain.entities · /api/story-brain.facts）'], contract: '只读面板+过滤/刷新；POV/秘密门禁不可被视觉绕过（ADR-0026）', landing: 'InspectorTower tab / nav SB → StoryBrainPanel' },
  'context-receipt': { requirement: ['完成一次装配（compile）后产生 Receipt'], contract: '只读+选择+回工作台；hashMatch 为服务端 sha256 复算真值（INV-R6）', landing: 'InspectorTower tab / nav CR → ReceiptPanel' },
  'change-matrix': { requirement: ['上游变更经 Traversal 传播后形成矩阵'], contract: 'rerun POST /api/change-matrix.rerun 仅 stale 行可用（幂等）；revisionBriefs 已在契约', landing: 'InspectorTower tab / nav CM → ChangeMatrixPanel' },
  'quality-gate': {
    requirement: ['章节处于 draft/review 会话（409 拒绝其他相位）'],
    unavailable: ['语义审查提供方未接入（Gate 3）——语义判定缺席时 verdict=REFUSED，fail-closed。'],
    contract: 'review/rework（上限 2，422 QualityReworkLimitExceeded）/corrections 全真实契约',
    landing: 'InspectorTower tab / nav QG → QualityPanel',
  },
  tasks: { requirement: ['任务事件源接入注册表/配置（当前 /api/tasks 只读流水已真实）'], contract: '列表/过滤/刷新真实；徽标计数待任务源接入前恒 0（诚实）', landing: 'nav 10 → TasksView' },
  'book-source': { requirement: ['本地书库 parentDir（已建书）', '外部网络可达（起点/七猫公开源、crawl4ai 可选）'], contract: 'search/extract/import 真实；degraded/notes 语义已入设计', landing: 'nav 11 → BookSourceView' },
  'book-shelf': { requirement: ['本地书库目录存在 book.json 结构'], contract: 'library / library.open / library.import 真实（409 重名显式冲突）', landing: 'nav 12 → BookshelfView' },
  'capability-square': { requirement: ['无需前提——注册表随服务端常驻'], contract: '只读注册表；enable/apply 无契约（不提供假按钮）', landing: 'nav 13 → CapabilitySquareView' },
  'rank-scan': {
    requirement: ['接入可验证的实时榜单数据源'],
    unavailable: ['网文榜单尚未接入可验证的实时数据源；Technical Preview 不返回静态示例榜单。（HTTP 501 · RANK_SOURCE_NOT_CONFIGURED）'],
    contract: '无——demo 榜为被 gate 遮蔽死代码；FUTURE DATA LAYOUT 已设计',
    landing: 'nav 14 → RankScanView（501 三态）',
  },
  'web-search': {
    requirement: ['接入真实外部搜索源'],
    unavailable: ['联网搜索尚未接入真实外部搜索源；Technical Preview 不返回内置示例冒充联网结果。（HTTP 501 · WEB_SEARCH_NOT_CONFIGURED）'],
    contract: '摘录复制为本地功能保留；hotQueries 仅真实响应存在',
    landing: 'nav 15 → WebSearchView（501 三态）',
  },
  'cloud-sync': {
    requirement: ['云端服务与账号体系上线'],
    unavailable: ['云同步尚未上线；当前仅为本地文件模式（Local-First）。备份：尚未提供可验证的备份归档，UI 不提供任何备份操作。（HTTP 501 · BACKUP_NOT_IMPLEMENTED，fail-closed）'],
    contract: 'localReady/offline_ready/storageUsage 真实读面；不宣称 cloud-synced',
    landing: 'nav 16 → CloudSyncView',
  },
  membership: {
    requirement: ['支付/激活/计费服务上线'],
    unavailable: ['正式购买与激活服务尚未上线，Pro 权益不对外宣称已解锁。/api/membership.activate 恒 501 且无 UI 调用。'],
    contract: 'license=null 真实态+规划中 plans；无购买/激活假按钮（测试断言缺席）',
    landing: 'nav 17 → MembershipView',
  },
}

export function detailOf(
  id: string,
  status: CapabilityStatus,
  label = '',
): CapabilityDetail {
  const known = CAPABILITY_DETAILS[id]
  if (known !== undefined) return known
  return {
    requirement: ['以能力注册表证据为准'],
    ...(status !== 'native' ? { unavailable: [`「${label || id}」的前提尚未满足——以状态徽标与证据行为准。`] } : {}),
    contract: '无独立动作契约（不提供假按钮）',
    landing: '—',
  }
}

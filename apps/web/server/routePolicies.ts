/**
 * apps/web · 全路由安全与多租户所有权策略注册表 (Route Policies · T09)。
 * 
 * 依照 reference/03-public-billing.md T09 规格：
 * - 明确分类每个 API 为 public / account / book / local-native / payment-webhook；
 * - 未知路径默认拒绝 (FAIL-CLOSED)；
 * - 自动化检查当前所有注册路由都在表中；
 * - hosted 模式下禁止访问 local-native 端点。
 */

export type RouteCategory =
  | 'public'          // 无需登录鉴权（如健康检查、注册登录、公开定价目录）
  | 'account'         // 需要已登录的有效 Session/Principal，主体级操作（如个人信息、设备管理、登出、注销）
  | 'book'            // 需要已登录 Session 且必须持有 AuthorizedBook（正文/分镜/生成/审查/流水等作品级操作）
  | 'local-native'    // 仅在本地单机 (local) 模式下开放，hosted 模式下 403 拒绝（如本地目录直接浏览）
  | 'payment-webhook' // 支付渠道异步通知，免普通 Session 登录但需支付签名强校验

export interface RoutePolicy {
  readonly path: string
  readonly category: RouteCategory
  readonly description?: string
}

export const ROUTE_POLICIES: Readonly<Record<string, RouteCategory>> = Object.freeze({
  // ---- 1. Public 开放路由 ----
  '/api/health': 'public',
  '/api/billing/catalog': 'public',
  '/api/capabilities': 'public',
  '/api/capability-square': 'public',
  '/api/truthful-preview': 'public',
  '/api/novel-breakdown': 'public',
  '/api/rank-scan': 'public',
  '/api/book-source.search': 'public',
  '/api/web-search': 'public',
  '/api/crawler.extract': 'public',
  '/api/account/register': 'public',
  '/api/account/login': 'public',
  '/api/account/reset-password-request': 'public',
  '/api/account/reset-password-confirm': 'public',
  '/api/auth/device/token': 'public',
  '/api/auth/device/refresh': 'public',
  '/api/membership': 'public',
  '/api/draft.question': 'public',
  '/api/style.distill': 'public',

  // ---- 2. Account 主体级路由 ----
  '/api/account': 'account',
  '/api/account/session': 'account',
  '/api/account/logout': 'account',
  '/api/account/delete': 'account',
  '/api/account/devices': 'account',
  '/api/account/devices/unbind': 'account',
  '/api/auth/device/authorize': 'account',
  '/api/auth/device/confirm': 'account',
  '/api/membership.activate': 'account',
  '/api/cloud-sync': 'account',
  '/api/cloud-sync.backup': 'account',
  '/api/book': 'account', // 创建新作品（在 hosted 下归属当前用户）

  // ---- 3. Local-Native 本地专用路由 (hosted 下 403 拒绝) ----
  '/api/library': 'local-native',
  '/api/library.open': 'local-native',
  '/api/library.import': 'local-native',

  // ---- 4. Book 作品级隔离路由 (要求 AuthorizedBook) ----
  '/api/book.state': 'book',
  '/api/story-brain.entities': 'book',
  '/api/story-brain.facts': 'book',
  '/api/chapter.prose': 'book',
  '/api/chapter.prose.save': 'book',
  '/api/chapter.reopen': 'book',
  '/api/receipts': 'book',
  '/api/receipt': 'book',
  '/api/change-matrix': 'book',
  '/api/change-matrix.rerun': 'book',
  '/api/works': 'book',
  '/api/tasks': 'book',
  '/api/ledger': 'book',
  '/api/session.open': 'book',
  '/api/session.advance': 'book',
  '/api/draft.stream': 'book',
  '/api/draft.candidate': 'book',
  '/api/draft.cancel': 'book',
  '/api/draft.accept': 'book',
  '/api/chapter.review': 'book',
  '/api/chapter.rework': 'book',
  '/api/chapter.corrections': 'book',
  '/api/chapter.quality': 'book',
  '/api/storyboard.source': 'book',
  '/api/storyboard.generate': 'book',
  '/api/storyboard.save': 'book',
  '/api/storyboards': 'book',
  '/api/storyboard': 'book',
  '/api/style': 'book',
})

/**
 * 查询指定路由的安全策略分类；未注册则返回 null（触发默认拒绝）。
 */
export function getRoutePolicy(path: string): RouteCategory | null {
  const normalized = path.split('?')[0] ?? path
  return ROUTE_POLICIES[normalized] ?? null
}

/**
 * 校验路由是否已在策略表中注册。
 */
export function isRegisteredRoute(path: string): boolean {
  return getRoutePolicy(path) !== null
}

/**
 * 获取所有已注册的路由路径清单。
 */
export function getAllRegisteredRoutes(): readonly string[] {
  return Object.keys(ROUTE_POLICIES)
}

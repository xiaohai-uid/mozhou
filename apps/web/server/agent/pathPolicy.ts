/**
 * apps/web/server/agent · 路径权限模型（智能体工具层的安全边界）。
 *
 * 对应 OpenWrite 的工具设计要点：**路径权限模型是安全边界，不是功能**。
 * 本项目按「允许 / 需确认 / 拒绝」三档判定，而不是简单的「能不能写」：
 *
 * - `allowed`            —— 书根内、技能根内：智能体可直接读写。
 * - `needs-confirmation` —— 上述之外的可读路径（外部目录、用户显式给出的路径）：
 *                           必须由宿主取得作者确认后才放行，工具自己不越权。
 * - `denied`             —— 结构性危险目标：空字节、系统目录、非绝对路径且无书根可解析。
 *
 * 为什么不直接「一律拒绝外部路径」：作者常需要把素材放到书根之外（如 D 盘的资料库）。
 * 一刀切会逼出绕过手段。这里保留确认档，把决定权交回作者，同时让每一次越界都可见。
 */
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

export type PathAccess = 'allowed' | 'needs-confirmation' | 'denied'

export interface PathPolicyDecision {
  readonly access: PathAccess
  /** 解析后的绝对路径；`denied` 且无法解析时为 null。 */
  readonly resolvedPath: string | null
  readonly reason: string
}

export interface PathPolicyOptions {
  /** 当前书根；null 表示尚无书（此时相对路径不可解析）。 */
  readonly bookRoot: string | null
  /** 技能根（技能目录与资源目录），与书根同为直读区。 */
  readonly skillRoots?: readonly string[]
}

/**
 * 已知的系统目录前缀：这些位置即使作者确认也不该由智能体写入。
 * 模式按 **POSIX 形态**书写（`toPosix` 之后统一是正斜杠），否则 Windows 盘符规则永远匹配不上。
 */
const SYSTEM_ROOT_PATTERNS: readonly RegExp[] = [
  /^[a-z]:\/windows(\/|$)/i,
  /^[a-z]:\/program files( \(x86\))?(\/|$)/i,
  /^[a-z]:\/programdata(\/|$)/i,
  /^\/(etc|bin|sbin|usr|var|boot|dev|proc|sys)(\/|$)/,
  /^\/(system|library\/apple|private\/etc)(\/|$)/i,
]

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/** `child` 是否落在 `parent` 之内（含 parent 自身）。两者都应是绝对路径。 */
function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

function matchesSystemRoot(posixPath: string): boolean {
  const lowered = posixPath.toLowerCase()
  return SYSTEM_ROOT_PATTERNS.some((re) => re.test(lowered))
}

/**
 * 判定一个路径可否被智能体访问。
 *
 * 顺序：空字节/非法 → 系统目录 → 解析绝对路径 → 书根/技能根内为 allowed，其余需确认。
 */
export function decidePathAccess(rawPath: unknown, options: PathPolicyOptions): PathPolicyDecision {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return { access: 'denied', resolvedPath: null, reason: '路径为空或不是字符串' }
  }
  // 空字节会在底层文件 API 处截断路径，是典型的绕过手段：直接拒绝，不给确认机会。
  if (rawPath.includes('\u0000')) {
    return { access: 'denied', resolvedPath: null, reason: '路径含空字节' }
  }

  const trimmed = rawPath.trim()
  // Windows 盘符路径在非 Windows 平台不是绝对路径：若不拦，它会被当成相对路径解析到
  // 书根内并被放行，「系统目录拒绝」这条安全性质就随平台漂移。
  // 2026-10-22 在 Linux CI 实测：C:\Windows\... 被判 allowed，Windows 上判 denied。
  if (process.platform !== 'win32' && /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return { access: 'denied', resolvedPath: null, reason: 'Windows 绝对路径在非 Windows 平台无法解析' }
  }
  if (!isAbsolute(trimmed) && options.bookRoot === null) {
    return { access: 'denied', resolvedPath: null, reason: '相对路径在无书根时无法解析' }
  }
  const base = options.bookRoot ?? process.cwd()
  const resolvedPath = normalize(isAbsolute(trimmed) ? trimmed : resolve(base, trimmed))

  if (matchesSystemRoot(toPosix(resolvedPath))) {
    return { access: 'denied', resolvedPath, reason: '系统目录不在智能体可写范围' }
  }

  const roots = [options.bookRoot, ...(options.skillRoots ?? [])].filter((r): r is string => typeof r === 'string' && r !== '')
  for (const root of roots) {
    if (isInside(resolvedPath, normalize(root))) {
      return { access: 'allowed', resolvedPath, reason: '位于书根或技能根内' }
    }
  }
  return { access: 'needs-confirmation', resolvedPath, reason: '位于书根与技能根之外，需要作者确认' }
}

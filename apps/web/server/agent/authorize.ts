/**
 * apps/web/server/agent · 工具层路径授权。
 *
 * 单独成文件是为了让每次改动的分析单元足够小：静态检查门 gate profile 的预算是
 * `maxDiffLines: 500` / `hardTimeoutMs: 1000`，把授权逻辑与工具实现分开后，
 * 每个文件的改动都远在预算之内，静态分析能完整跑完而不是降级。
 *
 * 职责只有一件：把 `decidePathAccess` 的判定接到工具层——拒绝档直接失败，
 * 确认档要作者同意，通过档才返回可用路径。
 */
import { decidePathAccess } from './pathPolicy.js'
import type { PathPolicyOptions } from './pathPolicy.js'
import type { ToolHost } from './toolHost.js'

export type AuthorizeResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string }

function policyFor(host: ToolHost): PathPolicyOptions {
  return { bookRoot: host.bookRoot, skillRoots: [host.skills.skillsRoot] }
}

export function authorize(rawPath: string, host: ToolHost): AuthorizeResult {
  const decision = decidePathAccess(rawPath, policyFor(host))
  if (decision.access === 'denied' || decision.resolvedPath === null) {
    return { ok: false, error: '路径被拒绝：' + decision.reason }
  }
  if (decision.access === 'needs-confirmation') {
    const confirmed = host.confirmExternalPath?.(decision.resolvedPath, decision.reason) === true
    if (!confirmed) return { ok: false, error: '路径需要作者确认：' + decision.reason }
  }
  return { ok: true, path: decision.resolvedPath }
}

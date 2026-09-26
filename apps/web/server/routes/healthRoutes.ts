/**
 * apps/web · 存活与就绪探针 (`/api/health`)。
 *
 * 此前该路径只在 `routePolicies.ts` 登记了 `public` 策略、没有任何处理器，
 * 请求会穿透到兜底分支返回 404——编排层拿不到就绪信号，`docker compose` 也无法
 * 配 healthcheck，故障只能靠人工发现。
 *
 * 就绪判据取「数据根可写」：书稿与账户数据都要落到该目录，不可写等于所有写入
 * 都会失败（只读挂载、权限错误），故返回 503 而非 200。
 *
 * 注意本检查**不能**发现「卷没挂上」：启动锁会 mkdir 出数据根，未挂卷时该路径
 * 同样存在且可写，数据只是落进了可丢的容器层。区分这一点靠 `dataRootSource`
 * 字段（容器里报 `default` 即说明没被显式钉到卷上），而非可写性。
 *
 * 刻意不回传版本号：服务器产物位于 `dist-server/`，解析仓库根 `package.json` 需要
 * 依赖构建布局的相对路径，脆弱且收益低；版本由启动日志与 release tag 承载。
 */
import { accessSync, constants } from 'node:fs'
import type { RouteHandler } from '../router.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { dataRootSource } from '../dataRoot.js'

export const healthRoutes: RouteHandler = (req, res, { path, json }) => {
  if (path !== '/api/health') return false

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'GET or HEAD required' })
    return true
  }

  const dataRoot = defaultBookAccessManager.getDataRoot()
  let dataRootWritable = false
  try {
    accessSync(dataRoot, constants.W_OK)
    dataRootWritable = true
  } catch {
    dataRootWritable = false
  }

  json(dataRootWritable ? 200 : 503, {
    ok: dataRootWritable,
    status: dataRootWritable ? 'ok' : 'degraded',
    // 回传解析后的数据根与来源：容器里「卷没挂上」与「挂了但路径解析错」表现相同，
    // 这两个字段是区分它们的直接证据。服务默认只监听回环地址。
    dataRoot,
    dataRootSource: dataRootSource(),
    dataRootWritable,
    hostedMode: defaultBookAccessManager.isHostedMode(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
  })
  return true
}

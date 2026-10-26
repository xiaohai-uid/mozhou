/**
 * 导航 / 新窗口 / 外链 / 权限的边界（迁移计划 §3.2「安全」）。
 *
 * 壳只承载一个受信任 origin（`http://127.0.0.1:<稳定端口>`）。工作台自身是 SPA，
 * 正常写作路径不需要任何跨站导航、新窗口或设备权限，故一律 fail-closed：
 *   - 顶层导航只允许同源 http://127.0.0.1:<端口>；其余取消导航；
 *   - 新窗口一律拒绝（`deny`），http/https 外链交给系统浏览器；
 *   - 只放行 http/https 两种外链协议，`file:`/`javascript:`/`data:` 等一律拒绝；
 *   - 权限请求（摄像头/麦克风/定位/通知/剪贴板…）全部拒绝。
 *
 * 这里**不**新增任何通用进程桥或文件桥：没有 preload 暴露的 IPC，渲染进程拿不到
 * Node 或文件系统能力（配合 main.mjs 的 nodeIntegration:false / contextIsolation:true /
 * sandbox:true）。CSP 与 Host/Origin 防护仍由服务端响应头承担（productionServer.ts:81-89）。
 */
import { logLine } from './log.mjs'

function isAllowedOrigin(rawUrl, allowedOrigin) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  return parsed.origin === allowedOrigin
}

function openExternalIfSafe(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    logLine(`[shell] 拒绝打开无法解析的链接：${rawUrl}`)
    return
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    logLine(`[shell] 拒绝非 http/https 外链协议：${parsed.protocol}`)
    return
  }
  void import('electron').then(({ shell }) => shell.openExternal(parsed.href))
}

/**
 * 把边界挂到该 session 与之后创建的所有 webContents 上。
 * `allowedOrigin` 形如 `http://127.0.0.1:43123`。
 */
export function hardenSession({ app, session, allowedOrigin }) {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    logLine(`[shell] 拒绝权限请求：${permission}`)
    callback(false)
  })
  session.setPermissionCheckHandler((_wc, permission) => {
    logLine(`[shell] 拒绝权限检查：${permission}`)
    return false
  })

  app.on('web-contents-created', (_event, contents) => {
    const blockNavigation = (event, url) => {
      if (isAllowedOrigin(url, allowedOrigin)) return
      event.preventDefault()
      logLine(`[shell] 取消越界导航：${url}`)
      openExternalIfSafe(url)
    }
    contents.on('will-navigate', blockNavigation)
    contents.on('will-redirect', blockNavigation)

    contents.setWindowOpenHandler(({ url }) => {
      logLine(`[shell] 拒绝新窗口：${url}`)
      openExternalIfSafe(url)
      return { action: 'deny' }
    })

    // 不使用 <webview>；一旦出现即拒绝挂载
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      logLine('[shell] 拒绝挂载 webview')
    })
  })
}

import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { moZhouApi } from './server/api'

// Windows 上 esbuild 处理超过 1MiB 的 transform 输入时，会先把输入写入
// os.tmpdir() 下的 esbuild-<hash> 临时文件，交给 esbuild 服务进程读取，
// 服务进程读完立即删除该文件。在默认的 %LOCALAPPDATA%\Temp 里，这次删除
// 会撞上 Windows Defender 对新落盘大文件的实时扫描窗口，报
// "remove ...: Access is denied" 并使 vite build 失败（esbuild 服务进程
// spawn 时不传 env，继承本进程环境变量，因此改 TEMP/TMP 对两侧同时生效）。
// 这里把临时目录重定向到仓库内 node_modules/.tmp/esbuild（.gitignore 已
// 覆盖 node_modules/），仅 Windows 生效；目录创建失败按原样抛错，不静默降级。
if (process.platform === 'win32') {
  const esbuildTmpDir = fileURLToPath(new URL('./node_modules/.tmp/esbuild', import.meta.url))
  mkdirSync(esbuildTmpDir, { recursive: true })
  process.env.TMP = esbuildTmpDir
  process.env.TEMP = esbuildTmpDir
}

export default defineConfig({
  plugins: [react(), tailwindcss(), moZhouApi()],
  server: { port: 5173 },
})

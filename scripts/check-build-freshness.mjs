#!/usr/bin/env node
/**
 * check-build-freshness.mjs —— 生产产物是否落后于源码。
 *
 * 为什么要有它：2026-10-12 的会话里，我按真实浏览器测作者路径时工作台当场崩在
 * `Cannot read properties of undefined (reading 'toFixed')`，差点当成产品缺陷记下来。
 * 真因是 apps/web/dist-server/routes/flywheelRoutes.js 建于 15:27，而源文件 16:19 才改
 * ——产物里新函数 preferenceProfileView 出现 0 次。**陈旧产物会制造假失败**。
 *
 * 仓内已有的 scripts/check-generated-freshness.mjs 只覆盖 docs/architecture.md 与
 * docs/term-map.md（且按 git 索引判定，而 dist/ 是忽略项，索引里根本没有），所以构建产物
 * 这一块此前无人看管。
 *
 * 判定：源码目录里最新的 mtime 晚于产物里最早的 mtime ⇒ 陈旧。产物不存在不算陈旧（那是
 * 「还没构建」，由 scripts/launcher.mjs 的缺失即构建分支处理）。
 *
 * 退出码：0 新鲜或未构建；1 陈旧（并打印重建命令）；2 环境错误。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE_DIRS = ['apps/web/src', 'apps/web/server', 'apps/web/shared']
const SOURCE_FILES = ['apps/web/index.html', 'apps/web/vite.config.ts']
const ARTIFACTS = ['apps/web/dist/index.html', 'apps/web/dist-server/productionServer.js']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-server', '.self-check'])

/** 目录树里最新的 mtime。 */
function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let info
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (info.isDirectory()) newest = Math.max(newest, newestMtime(full))
    else newest = Math.max(newest, info.mtimeMs)
  }
  return newest
}

let sourceDirs
try {
  sourceDirs = [...SOURCE_DIRS, ...readdirSync(join(root, 'packages')).map((p) => `packages/${p}/src`)]
} catch (error) {
  console.error(`环境错误：无法枚举源码目录 —— ${error.message}`)
  process.exit(2)
}

const present = ARTIFACTS.filter((a) => existsSync(join(root, a)))
if (present.length === 0) {
  console.log('PASS 构建产物新鲜度：产物尚未构建，跳过（launcher 会在缺失时构建）。')
  process.exit(0)
}

let newestSource = 0
let newestSourceDir = ''
for (const dir of sourceDirs) {
  const full = join(root, dir)
  if (!existsSync(full)) continue
  const m = newestMtime(full)
  if (m > newestSource) {
    newestSource = m
    newestSourceDir = dir
  }
}
for (const file of SOURCE_FILES) {
  const full = join(root, file)
  if (!existsSync(full)) continue
  const m = statSync(full).mtimeMs
  if (m > newestSource) {
    newestSource = m
    newestSourceDir = file
  }
}

const oldestArtifact = Math.min(...present.map((a) => statSync(join(root, a)).mtimeMs))
const oldestArtifactPath = present.reduce((min, a) => (statSync(join(root, a)).mtimeMs < statSync(join(root, min)).mtimeMs ? a : min), present[0])

if (newestSource > oldestArtifact) {
  const behind = Math.round((newestSource - oldestArtifact) / 1000)
  console.error('FAIL 构建产物陈旧：')
  console.error(`  - ${relative(root, join(root, newestSourceDir)).replace(/\\/g, '/')} 比 ${oldestArtifactPath} 新 ${behind}s`)
  console.error('  - 陈旧产物会制造假失败（2026-10-12 实测：工作台崩溃被误判为产品缺陷）')
  console.error('  - 重建：pnpm --filter @mozhou/web build')
  process.exit(1)
}

console.log(`PASS 构建产物新鲜度：${present.length} 个产物均不早于源码。`)

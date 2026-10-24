#!/usr/bin/env node
/**
 * check-gen-determinism.mjs —— 生成器遍历确定性检查。
 *
 * 背景：2026-10-24 推送前门实测，gen-term-map.mjs 用 readdirSync 的返回顺序遍历，
 * 而 NTFS 与 ext4/overlayfs 的目录项顺序不同，同一份源码在两平台生成出不同的
 * docs/term-map.md：本机 --check 通过、Linux CI 报 STALE。该缺陷靠评审抓不住，
 * 只有跨平台跑才暴露，所以用这条近似 tripwire 拦「完全没排序意识」的回归。
 *
 * 规则：scripts/gen-*.mjs 里出现 readdirSync 的文件，必须同时包含 sort(
 * （对目录项或最终文件列表做确定性排序）。这是近似检查：它不能证明排序键正确，
 * 只能拦住「完全没有排序」的新生成器。
 *
 * 退出码：0 一致；1 有违规。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const genDir = join(root, 'scripts')

const violations = []
for (const e of readdirSync(genDir).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
  if (!/^gen-.*\.mjs$/.test(e.name)) continue
  const text = readFileSync(join(genDir, e.name), 'utf8')
  if (!text.includes('readdirSync')) continue
  if (!/\bsort\s*\(/.test(text)) {
    violations.push(`scripts/${e.name}：使用 readdirSync 但没有 sort(...) —— 生成物会随文件系统目录项顺序漂移`)
  }
}

if (violations.length > 0) {
  console.error('FAIL 生成器确定性检查：')
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log('PASS 生成器确定性检查：全部 gen-*.mjs 的目录遍历已排序。')

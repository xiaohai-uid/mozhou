import { defineConfig } from 'vitest/config'

/**
 * 墙钟规格台架专用配置（packages/context-compiler/src/l1-lifecycle-bench.test.ts）。
 *
 * 为什么单独跑：该文件断言「50 章全弧 <5s」是**墙钟**预算。与其余测试文件并行时，
 * CPU/IO 争用会把被测的 durationMs 推过预算——2026-10-10 实测：同一提交在
 * `pnpm test`（全量并行）里失败、单独跑通过、重跑又通过。墙钟预算只有在独占环境下
 * 才有意义，所以这里不设并行、只收这一个文件。
 *
 * 注意：本配置不是「跳过」该断言，只是把它放进能被正确测量的环境。把本文件从
 * test:packages 摘掉会让这条规格静默失效——改这里必须同时改 package.json。
 */
export default defineConfig({
  test: {
    include: ['packages/context-compiler/src/l1-lifecycle-bench.test.ts'],
    fileParallelism: false,
  },
})

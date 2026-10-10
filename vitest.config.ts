import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    // 墙钟规格台架（50 章全弧 <5s）不参与并行跑：它与其余 118 个文件并行时，
    // CPU/IO 争用会把被测的 durationMs 推过预算，产生与产品无关的红（2026-10-10
    // 实测：全量并行跑失败、单独跑通过、重跑又通过）。该文件由
    // vitest.bench.config.ts 独占运行，入口是 package.json 的 test:packages。
    exclude: [...configDefaults.exclude, 'packages/context-compiler/src/l1-lifecycle-bench.test.ts'],
    coverage: {
      // 只输出实测数字，不设阻断阈值。
      // DSH 的「逐文件 100%」不适用于本仓；阈值须由人看过真实数字后再定。
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
})

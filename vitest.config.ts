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
      // 先冻结分母再采基线：include 只取生产源码，未触达文件按 0% 计入。
      // 排除测试、类型声明与测试夹具；不按“数字难看”追加排除。
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage/packages',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.d.ts',
        'packages/*/src/**/fixtures/**',
      ],
      // 阈值取 2026-10-17 实测值下方 1.4~2.0 个点；只做防退化，不做逐文件要求。
      thresholds: {
        lines: 81,
        statements: 79,
        functions: 85,
        branches: 68,
        perFile: false,
        autoUpdate: false,
      },
    },
  },
})

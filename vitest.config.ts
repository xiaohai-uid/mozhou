import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    coverage: {
      // 只输出实测数字，不设阻断阈值。
      // DSH 的「逐文件 100%」不适用于本仓；阈值须由人看过真实数字后再定。
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
})

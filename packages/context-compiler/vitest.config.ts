import { defineConfig } from 'vitest/config'

// 包内直跑（pnpm --filter @mozhou/context-compiler test）；全仓跑由根 include 覆盖
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})

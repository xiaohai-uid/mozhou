import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 10000,
    // Windows 环境下 jsdom 并行 fork 进程池极易触发 IPC 管道撕裂（EPIPE）；
    // 固定 maxWorkers=2 限制并发池规模，保证全量测试稳定通过。
    maxWorkers: 2,
    coverage: {
      // web 配置根是 apps/web；统一输出到仓库根 coverage/web。
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: '../../coverage/web',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'server/**/*.test.ts',
        'src/test/**',
        'src/**/*.d.ts',
        'server/**/*.d.ts',
      ],
      // 阈值取 2026-10-17 实测值下方 1.5~1.8 个点；只做防退化，不做逐文件要求。
      thresholds: {
        lines: 77,
        statements: 75,
        functions: 73,
        branches: 69,
        perFile: false,
        autoUpdate: false,
      },
    },
  },
})

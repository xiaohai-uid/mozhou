import { configDefaults, defineConfig } from 'vitest/config'

// #45 实验配置：验证 project/pool 拆分能否让 perf 冒烟在满量并行下独占资源。
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'packages/context-compiler/src/embedding.perf.test.ts'],
        },
      },
      {
        test: {
          name: 'perf',
          include: ['packages/context-compiler/src/embedding.perf.test.ts'],
          fileParallelism: false,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
})

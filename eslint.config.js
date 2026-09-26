import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-server/**', '**/node_modules/**', '**/.next/**', '**/*.config.js', '**/*.config.ts', 'prototype/**', 'docs/**', 'app/**', 'scripts/embedding-calib/**', 'scripts/verify-r05-journey.mjs', 'scripts/release/**', '.scratch/**', 'figma-upload/**', '.gitnexus/**', 'archive-legacy/**', 'evidence/**', 'release-artifacts/**', '**/.worktrees/**', '**/.zcode/**'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // 根 scripts/ 的独立运维脚本（不入任何 tsconfig project）仍接受类型化 lint；
        // productionServer.ts 是无引用的生产入口（无人 import，进不了任何 TS program）。
        // defaultProject 指向 server 编译配置，为这些孤立文件提供 node 类型环境。
        // 服务端 *.test.ts 不在 app 工程（include: src）内；projectService 只按目录
        // 发现 tsconfig.json，tsconfig.server.json 不被自动发现——按目录扁平登记
        // （allowDefaultProject 不支持递归 glob，新 server 测试目录需在此补一行）。
        // observability.ts 与 productionServer.ts 一样是无引用的孤儿模块，进不了任何
        // TS program，需在此登记；dataRoot.ts 被 bookAccess.ts 引用、可被项目服务
        // 传递发现，登记进 allowDefaultProject 反而报「重复包含」。
        projectService: {
          allowDefaultProject: [
            'scripts/*.mjs',
            'apps/web/server/productionServer.ts',
            'apps/web/server/observability.ts',
            'apps/web/server/*.test.ts',
            'apps/web/server/routes/*.test.ts',
            'apps/web/server/storyboard/*.test.ts',
            'apps/web/server/billing/*.test.ts',
            'apps/web/server/auth/*.test.ts',
            'apps/web/server/search/*.test.ts',
            'apps/web/server/analysis/*.test.ts',
            'apps/web/server/skills/*.test.ts',
            'apps/web/server/llm/*.test.ts',
          ],
          defaultProject: 'apps/web/tsconfig.server.json',
          // 2026-09-26 由 50 上调至 64：observability 模块 + 四个新测试文件
          // （dataRoot/observability/healthRoutes/masterKey）计入默认项目。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 64,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Gate A N9 禁令，error 级
      'no-empty': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['scripts/*.mjs'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
)

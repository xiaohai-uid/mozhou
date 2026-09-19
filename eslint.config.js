import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-server/**', '**/node_modules/**', '**/.next/**', '**/*.config.js', '**/*.config.ts', 'prototype/**', 'docs/**', 'app/**', 'scripts/embedding-calib/**', 'scripts/verify-r05-journey.mjs', 'scripts/release/**', '.scratch/**', 'figma-upload/**', '.gitnexus/**', 'archive-legacy/**', 'evidence/**', 'release-artifacts/**'] },
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
        projectService: {
          allowDefaultProject: [
            'scripts/*.mjs',
            'apps/web/server/productionServer.ts',
            'apps/web/server/*.test.ts',
            'apps/web/server/routes/*.test.ts',
            'apps/web/server/storyboard/*.test.ts',
            'apps/web/server/billing/*.test.ts',
            'apps/web/server/auth/*.test.ts',
            'apps/web/server/search/*.test.ts',
            'apps/web/server/analysis/*.test.ts',
            'apps/web/server/skills/*.test.ts',
          ],
          defaultProject: 'apps/web/tsconfig.server.json',
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 50,
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
)

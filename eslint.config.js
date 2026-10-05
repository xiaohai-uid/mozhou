import tseslint from 'typescript-eslint'

export default tseslint.config(
  // 交回包是归档证据与仓库外脚本副本，不属于产品 TypeScript 工程。
  { ignores: ['handoff-results/**'] },
  { ignores: ['**/dist/**', '**/dist-server/**', '**/node_modules/**', '**/.next/**', '**/*.config.js', '**/*.config.ts', 'prototype/**', 'docs/**', 'app/**', 'scripts/embedding-calib/**', 'scripts/verify-r05-journey.mjs', 'scripts/release/**', '.scratch/**', 'figma-upload/**', '.gitnexus/**', 'archive-legacy/**', 'evidence/**', 'release-artifacts/**', '.dsh-audit/**', 'artifacts/**', '.tmp-vite-build/**', '**/.worktrees/**', '**/.zcode/**', 'audit-2026-10-03/**'] },
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
            'scripts/*.d.mts',
            'scripts/*.mjs',
            // 2026-10-05：scripts 新增子目录（语料库/共享库）同样不被任何 tsconfig project
            // 发现；allowDefaultProject 不支持递归 glob，按目录逐行登记。
            'scripts/corpus/*.mjs',
            'scripts/lib/*.mjs',
            // 2026-10-05：apps/web/shared 的手维护 js 子集不被 app 工程（include: src）发现，
            // 与 scripts 同属「不入任何 TS project」的独立文件。同目录 .ts 已被项目服务
            // 传递发现（src 引用），登记进白名单反而报「重复包含」——故只登记 .js。
            'apps/web/shared/*.js',
            // operations.schema.ts 是孤儿 schema（无传递引用者），与 productionServer.ts
            // 同类：按单文件登记；同目录其余 .ts 被项目服务发现，不能用 glob（见上）。
            'apps/web/shared/operations.schema.ts',
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
            // 工单 08 新增：句柄 seam 的真实语义测试（packages/data-plane 那份走
            // 自己的 tsconfig，不经 defaultProject；这里的是路由级迁移回归）。
            'apps/web/server/routes/planeSeamMigration.test.ts',
            // 2026-09-30 整改 T02 新增：真实模型测试的统一门控目录。
            // 含门控实现 realModelGate.ts（非测试文件，同样不被任何 project 发现）
            // 与它自己的确定性测试 realModelGate.test.ts —— 两者都要登记，
            // 只登记 *.test.ts 会让实现文件本身继续报 Parsing error。
            'apps/web/server/test-support/*.ts',
            // 2026-10-05：写锁平台层测试目录同样不被任何 project 发现，按目录补登记。
            'apps/web/server/platform/*.test.ts',
          ],
          defaultProject: 'apps/web/tsconfig.server.json',
          // 2026-10-02 由 80 上调至 120：服务端新增测试文件使 defaultProject 匹配数达到 86，
          // 上调至 120 恢复 pnpm lint 门禁。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 120,
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
    // 根 scripts/ 的独立运维脚本（含 corpus/、lib/ 等子目录）：同属不入任何 tsconfig
    // project 的一次性脚本，与顶层 scripts/*.mjs 同一策略——保留类型化 lint，
    // 豁免 unsafe 家族（2026-10-05 由 scripts/*.mjs 扩到递归，corpus/lib 首次进入
    // 类型化检查后暴露同类错误，按既有策略对齐而非新增豁免）。
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // 工单 08：LocalDataPlane 句柄生命周期门禁。
    //
    // 为什么是 eslint 而不是那条 245 行的正则源码扫描守卫（apps/web/server/planeHandles.test.ts，
    // 已随本票删除）：忘记 close 的 SQLite 句柄**不报错、不崩、测试照样全绿**，
    // 所以判据必须落在源码结构上，而不是运行时断言。`no-restricted-syntax` 直接禁掉
    // 裸 `LocalDataPlane.open/openOrRebuild` 这个 AST 形态——比正则更准（不误伤字符串与
    // 注释），比自检用例便宜（零测试成本，且不会被 skip），且天然跟着常规 `pnpm lint` 走。
    //
    // seam 在 packages/data-plane/src/with-plane.ts：借出的句柄没有名字，调用点想忘也忘不掉。
    // 真正需要长活句柄的持有者（常驻对账宿主、提交编排、生命周期台架）走 retainBook/releaseBook
    // 成对转移——那是另一种源码形态，门禁不误报，review 也看得见配对。
    files: [
      'apps/web/server/**/*.ts',
      'apps/web/src/**/*.ts',
      'apps/web/src/**/*.tsx',
      'packages/*/src/**/*.ts',
    ],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/tests/**',
      // seam 自身与 LocalDataPlane 类：open 的定义处（openOrRebuild 内部委派）。
      'packages/data-plane/src/with-plane.ts',
      'packages/data-plane/src/local-data-plane.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="LocalDataPlane"][callee.property.name=/^(open|openOrRebuild)$/]',
          message: '裸 LocalDataPlane.open/openOrRebuild 会让 SQLite 句柄泄漏（不报错、不崩、测试照样全绿）。改用 withBook(root, fn) / withStrictBook(root, fn)；确需长活句柄则用 retainBook/releaseBook 成对转移（packages/data-plane/src/with-plane.ts）。',
        },
      ],
    },
  },
  {
    // W5 接口防护 (Plan §6.6)：阻断 apps/web/src 生产源码对 server/ 私有实现的跨层引用
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/src/**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/server',
                '**/server/**',
                '../server/**',
                '../../server/**',
                'apps/web/server/**',
              ],
              message:
                '架构禁令 (Plan §6.6)：apps/web/src 下的 UI 模块禁止 import server 内部代码。请使用 apps/web/shared/ 共享 DTO 或通过 HTTP 客户端通信。',
            },
          ],
        },
      ],
    },
  },
)

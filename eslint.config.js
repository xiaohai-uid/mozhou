import tseslint from 'typescript-eslint'

export default tseslint.config(
  // 交回包是归档证据与仓库外脚本副本，不属于产品 TypeScript 工程。
  { ignores: ['handoff-results/**'] },
  { ignores: ['**/dist/**', '**/dist-server/**', '**/node_modules/**', '**/.next/**', '**/*.config.js', '**/*.config.ts', 'prototype/**', 'docs/**', 'app/**', 'scripts/embedding-calib/**', 'scripts/verify-r05-journey.mjs', 'scripts/release/**', '.scratch/**', 'figma-upload/**', '.gitnexus/**', 'archive-legacy/**', 'evidence/**', 'release-artifacts/**', '.dsh-audit/**', 'artifacts/**', '.tmp-vite-build/**', '**/.worktrees/**', '**/.zcode/**'] },
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
          ],
          defaultProject: 'apps/web/tsconfig.server.json',
          // 2026-09-29 由 70 上调至 80：本票的 P1 首章回归测试
          // （routes/pipelineRoutes.firstChapter{,.realModel}.test.ts）走
          // defaultProject，与根 scripts/*.mjs、既有 server 测试共用这一个计数。
          // 上调前实测占用 70 —— 正好卡在阈值上，本票新增 2 个文件即溢出，
          // 报「Too many files (>70) have matched the default project」并让
          // 整条 `eslint .` 失败（连带 scripts/verify-usability-evidence.mjs
          // 一起报 Parsing error，是连带受害者而非自身有问题）。
          // 按实际占用抬到 80，与前两次（64→70）同一处置口径。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 80,
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
)

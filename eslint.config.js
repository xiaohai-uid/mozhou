import tseslint from 'typescript-eslint'
import sonarjs from 'eslint-plugin-sonarjs'

export default tseslint.config(
  // 交回包是归档证据与仓库外脚本副本，不属于产品 TypeScript 工程。
  { ignores: ['handoff-results/**'] },
  { ignores: ['**/dist/**', '**/dist-server/**', '**/target/**', 'src-tauri/target/**', '**/node_modules/**', '**/.next/**', '**/*.config.js', '**/*.config.ts', 'prototype/**', 'docs/**', 'app/**', 'scripts/embedding-calib/**', 'scripts/verify-r05-journey.mjs', 'scripts/release/**', 'desktop/**', '.scratch/**', 'figma-upload/**', '.gitnexus/**', 'archive-legacy/**', 'evidence/**', 'release-artifacts/**', '.dsh-audit/**', 'artifacts/**', '.tmp-vite-build/**', '**/.worktrees/**', '**/.zcode/**', 'audit-2026-10-03/**', 'perf/**', 'packages/benchmark/promptfoo/**', 'apps/web/server/platform/__fixtures__/**'] },
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
        // 新目录的 lint 归属，三分支判定（2026-10-12 复盘补，实际踩过一次）：
        //   1. 在 pnpm workspace 内（packages/*、apps/*）→ 由项目服务发现，无需登记；
        //   2. scripts 式的独立运维脚本 → 逐行登记进 allowDefaultProject（不支持递归 glob），
        //      并按目录关掉 no-unsafe-*（这些文件没有类型信息）；
        //   3. 既不在 workspace、也无 tsconfig 覆盖的新顶层区域（例如 desktop/）→ 加进上面的
        //      ignores。**不要走第 2 条**：登记会把纯 JS 文件按类型规则 lint（实测 186 个
        //      no-unsafe-*），还会把 default project 的匹配数推过 ts-eslint 的 140 上限，
        //      连累 scripts/ 下两个无关文件报「Too many files matched the default project」。
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
            // 深化 08 新增：句柄 seam 的真实语义测试（packages/data-plane 那份走
            // 自己的 tsconfig，不经 defaultProject；这里的是路由级迁移回归）。
            'apps/web/server/routes/planeSeamMigration.test.ts',
            // 2026-09-30 整改 T02 新增：真实模型测试的统一门控目录。
            // 含门控实现 realModelGate.ts（非测试文件，同样不被任何 project 发现）
            // 与它自己的确定性测试 realModelGate.test.ts —— 两者都要登记，
            // 只登记 *.test.ts 会让实现文件本身继续报 Parsing error。
            'apps/web/server/test-support/*.ts',
            // 2026-10-05：写锁平台层测试目录同样不被任何 project 发现，按目录补登记。
            'apps/web/server/platform/*.test.ts',
            // 2026-10-09：爬虫目录的 SSRF 过滤测试（B1 修复新增）同样不被任何 project
            // 发现，按同一先例补登记。
            'apps/web/server/crawlers/*.test.ts',
            // 2026-10-12：出站传输层目录（地址绑定 + 解压）同样不被任何 project 发现，
            // 按同一先例补登记。
            'apps/web/server/net/*.test.ts',
            // 2026-10-18：agent 与 recycle 目录由 21b05ad 引入；源码均已接入 api.ts，
            // 仅测试文件需要 defaultProject 支持。
            'apps/web/server/agent/*.test.ts',
            'apps/web/server/recycle/*.test.ts',
            // 2026-10-24：章后事实账本 facts 目录（#117）按同一先例补登记。
            'apps/web/server/facts/*.test.ts',
          ],
          defaultProject: 'apps/web/tsconfig.server.json',
          // 2026-10-02 由 80 上调至 120：服务端新增测试文件使 defaultProject 匹配数达到 86，
          // 上调至 120 恢复 pnpm lint 门。
          // 2026-10-09 由 120 上调至 140：服务端新增测试文件后匹配数达 121，触顶报
          // 「Too many files (>120) matched the default project」；按同一先例上调。
          // 2026-10-18 由 140 上调至 165：agent/recycle 补登记后匹配数达 153，按同一先例上调。
          // 长期正解是让 server/ 有可被 projectService 发现的 tsconfig，而不是持续抬高阈值。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 165,
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
    // 深化 08：LocalDataPlane 句柄生命周期门。
    //
    // 为什么是 eslint 而不是那条 245 行的正则源码扫描门（apps/web/server/planeHandles.test.ts，
    // 已随本票删除）：忘记 close 的 SQLite 句柄**不报错、不崩、测试照样全绿**，
    // 所以判据必须落在源码结构上，而不是运行时断言。`no-restricted-syntax` 直接禁掉
    // 裸 `LocalDataPlane.open/openOrRebuild` 这个 AST 形态——比正则更准（不误伤字符串与
    // 注释），比自检用例便宜（零测试成本，且不会被 skip），且天然跟着常规 `pnpm lint` 走。
    //
    // seam 在 packages/data-plane/src/with-plane.ts：借出的句柄没有名字，调用点想忘也忘不掉。
    // 真正需要长活句柄的持有者（常驻对账宿主、提交编排、生命周期台架）走 retainBook/releaseBook
    // 成对转移——那是另一种源码形态，门不误报，review 也看得见配对。
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
  {
    // 用户数据写盘的机械阻断门：**整份重写**必须走共享原子写原语 atomicWriteFileSync
    // （唯一临时名 + wx 独占创建 + fsync + rename），裸 writeFileSync 会留下半份文件。
    //
    // 为什么做成规则而不是写进 CODING_STANDARDS.md：这是纯机械规则（一个固定的 API 形态），
    // 而且已被证明会重复发生——2026-10-10 的会话里靠人工 grep 才找出 11 处这类裸写
    // （draft-step / compile-step / user-edit-step / proposal-step / proposal-port /
    // flywheel storage / memoStore / receipt-file / report-store / styleAnalysis /
    // book-backup restore / backupRoutes），同类问题在四轮对抗复核里反复出现。
    // 按「机械规则一律做成确定性检查、只把判断题留给评审」的纪律，它该是 lint 规则。
    //
    // 追加用 appendFileSync；独占创建用 writeFileSync(path, data, { flag: 'wx' })——两者都不触发本规则。
    files: ['packages/*/src/**/*.ts', 'apps/web/server/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/data-plane/src/atomic-write.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='writeFileSync']",
          message:
            '整份重写请改用 atomicWriteFileSync（@mozhou/data-plane 的共享原语）；追加请用 appendFileSync；独占创建请用 { flag: "wx" }。若确有正当例外，加进 eslint.config.js 的允许清单并写明理由。',
        },
      ],
    },
  },
  {
    // 允许清单（writeFileSync 的正当用法，不是遗漏）：
    // - bookAccess.ts 对**已打开的锁文件 fd** 写入（配 ftruncateSync），不是路径写，
    //   损坏由读侧「判 null 后接管」兜住；
    // - providerSettings.ts 用 { flag: 'wx', mode: 0o600 } 独占创建安装密钥——原子写原语
    //   不接受 mode/flags，这里必须用裸 writeFileSync。
    files: ['apps/web/server/bookAccess.ts', 'apps/web/server/llm/providerSettings.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // SonarJS 复杂度/坏味道档（2026-10-18 新增）。
    //
    // 只覆盖产品源码（packages/*/src、apps/web/src、apps/web/server、apps/web/shared），
    // 测试文件与 scripts 运维脚本不进：测试的价值在于直白，不在复杂度；一次性脚本
    // 不该受产品门约束。
    //
    // **接入纪律（2026-10-18 实测后定，不是拍脑袋）**：
    // 若把 recommended 规则集原样挂上，实测 error 会暴涨到 398——sonarjs 的规则默认
    // 是 error 级，一天之内让 CI 门红 385 处，等于拿新工具当阻断门用，而存量改造一天做不完。
    // **所以这里全部规则显式定档，不依赖 recommended 的默认级：**
    //   - 确定性的坏味道（no-nested-conditional 等）→ warn：看得见、不阻断，
    //     按「每周清一批」的节奏处理；
    //   - 纯风格/可争议项（prefer-read-only-props、no-alphabetical-sort、
    //     function-return-type、use-type-alias、deprecation 等）→ off：这些规则
    //     的收益取决于团队共识，先不占注意力，需要时按个案打开；
    //   - cognitive-complexity 阈值 30：比 SonarJS 默认 15 宽一倍，先只冒真正
    //     离谱的函数。收敛动作单独提交、与功能改动分开，避免混淆回归归因。
    //
    // **可证伪的门承诺**：本段只增加 warning，不增加 error。若 `pnpm lint`
    // 的 errorTotal > 0，说明本段的定档被破坏了或有未登记的新目录文件。
    files: [
      'packages/*/src/**/*.ts',
      'apps/web/src/**/*.ts',
      'apps/web/src/**/*.tsx',
      'apps/web/server/**/*.ts',
      'apps/web/shared/**/*.ts',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    plugins: { sonarjs },
    rules: {
      // 确定性坏味道：warn（可观测，不阻断）
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-duplicated-branches': 'warn',
      'sonarjs/no-identical-conditions': 'warn',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-identical-expressions': 'warn',
      'sonarjs/no-all-duplicated-branches': 'warn',
      'sonarjs/no-element-overwrite': 'warn',
      'sonarjs/no-extra-arguments': 'warn',
      'sonarjs/no-empty-collection': 'warn',
      'sonarjs/no-unused-collection': 'warn',
      'sonarjs/no-use-of-empty-return-value': 'warn',
      'sonarjs/no-gratuitous-expressions': 'warn',
      'sonarjs/no-inverted-boolean-check': 'warn',
      'sonarjs/no-collection-size-mischeck': 'warn',
      'sonarjs/void-use': 'warn',
      'sonarjs/no-dead-store': 'warn',
      'sonarjs/no-try-promise': 'warn',
      'sonarjs/no-unenclosed-multiline-block': 'warn',
      'sonarjs/no-regex-spaces': 'warn',
      'sonarjs/super-linear-regex': 'warn',
      'sonarjs/regex-complexity': 'warn',
      'sonarjs/duplicates-in-character-class': 'warn',
      'sonarjs/single-character-alternation': 'warn',
      'sonarjs/concise-regex': 'warn',
      'sonarjs/prefer-regexp-exec': 'warn',
      'sonarjs/cognitive-complexity': ['warn', 30],
      'sonarjs/no-os-command-from-path': 'warn',
      'sonarjs/generator-without-yield': 'warn',
      'sonarjs/no-nested-template-literals': 'off',
      // 纯风格/可争议项：off（需要时按个案打开，逐项升级为 warn）
      'sonarjs/prefer-read-only-props': 'off',
      'sonarjs/no-alphabetical-sort': 'off',
      'sonarjs/function-return-type': 'off',
      'sonarjs/use-type-alias': 'off',
      'sonarjs/deprecation': 'off',
      'sonarjs/different-types-comparison': 'warn',
      'sonarjs/no-misleading-array-reverse': 'warn',
    },
  },
)

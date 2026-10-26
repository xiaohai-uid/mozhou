# CHG-20261017-01 — 覆盖率门禁启用与双套阈值

- **需求来源**：用户 2026-10-17 批准「工具链补齐」计划，要求按审查修订版把覆盖率门禁落到 novel-ai；此前 `docs/gates.md` 明确标注覆盖率未启用、阈值刻意未设。
- **观察基线**：HEAD `e2ede76`，分支 `feature/windows-local-release`，相对 origin ahead 7，工作区干净；vitest 根与 web 实装/锁文件均为 `4.1.11`；`@vitest/coverage-v8` 未安装；`vitest.config.ts` 有 coverage 占位但无 include/阈值；`ci.yml`、`release.yml` 均未跑覆盖率。
- **目标行为**：包层与 Web 层各自统计覆盖率，冻结分母，按实测值设防退化阈值；正常测试通过时门禁通过，覆盖率低于阈值时 CI 阻断；性能台架保持无覆盖率且独占运行。
- **范围**：`package.json`、`apps/web/package.json`、`vitest.config.ts`、`apps/web/vitest.config.ts`、`pnpm-lock.yaml`、`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`.gitignore`、`scripts/ci-gate.mjs`、`scripts/report-coverage-status.mjs`、`docs/gates.md`、`PROJECT-MAP.md`。
- **实际变更**：
  1. 根与 `apps/web` 各精确安装 `@vitest/coverage-v8@4.1.11`，与 `vitest@4.1.11` 对齐；锁文件新增 11 个包（含 istanbul 系列），未顺手升级 vitest。
  2. 根 coverage 的 `include` 冻结为 `packages/*/src/**/*.ts`，排除测试、`.d.ts` 与 `fixtures`；Web coverage 的 `include` 为 `src/**/*.{ts,tsx}` 与 `server/**/*.ts`，排除测试、`src/test/**` 与 `.d.ts`。
  3. 输出目录分离：根 `coverage/packages`，Web 从自身根解析到 `../../coverage/web`；两套都保留 `text-summary` 与 `json-summary`。
  4. 新增脚本：根 `test:coverage:packages` = `vitest run --coverage && vitest run --config vitest.bench.config.ts`；根 `test:coverage:web`；Web `test:coverage` = `vitest run --coverage --maxWorkers=2`。
  5. `ci.yml` 与 `release.yml` 用覆盖率命令替换原测试步骤，不新增重复步骤；Web 覆盖率保持在 `dist-server` 构建之后。
  6. 本地推送门 `scripts/ci-gate.mjs test` 改为同一组覆盖率命令；快速测试入口 `test` / `test:packages` / `test:web` 保留。
  7. `scripts/report-coverage-status.mjs` 重新定位为配置完整性检查：检查两侧配置、四维阈值、`perFile`/`autoUpdate`、provider 安装与版本对齐；明确不读取旧报告。
  8. `.gitignore` 新增 `coverage/`、`coverage-negative/` 与 `.serena/`；`docs/gates.md` 回填双套实测值与阈值。
- **实测基线（2026-10-17，Windows 本机）**：
  - 包层：行 82.75%（7223/8728）、语句 80.40%（7748/9636）、函数 86.42%（1305/1510）、分支 69.91%（4646/6645）；测试 122 文件 / 1091 例 + 台架 1 文件 / 3 例。
  - Web 层：行 78.80%（9159/11623）、语句 76.76%（9887/12880）、函数 74.64%（1643/2201）、分支 70.55%（6866/9732）；测试 171 文件 / 1443 例通过，15 例跳过。
- **阈值**：包层 `lines 81 / statements 79 / functions 85 / branches 68`；Web `lines 77 / statements 75 / functions 73 / branches 69`；两套均 `perFile: false`、`autoUpdate: false`。阈值取实测值下方 1.4~2.0 个点，只做防退化。
- **负例验证**：`vitest run --coverage --coverage.thresholds.lines=100 --coverage.reportsDirectory=coverage-negative/packages` 退出码 1，输出 `ERROR: Coverage for lines (82.75%) does not meet global threshold (100%)`，负例报告写独立目录，未覆盖正式基线。
- **稳定性处理**：首次 Web 覆盖率运行出现 2 个 worker fork EPIPE（退出码 1，少统计 1 个文件 / 7 例）；复跑通过。为降低 Windows 上插桩并发压力，Web 覆盖率固定 `--maxWorkers=2`，随后连续两轮退出码 0 且四个维度数字完全一致。该现象记录为运行环境偶发，不记为测试失败。
- **验收**：
  - 正常路径：`pnpm run test:coverage:packages` exit 0；`pnpm run test:coverage:web` exit 0。
  - 负例：exit 1，原因确为 coverage threshold。
  - 安装：`ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm install --frozen-lockfile` exit 0。
  - 文档门：`check:gates`、`check:glossary`、`check:architecture`、`check:term-map`、`check:readmes`、`check-gates-ci-column` 全部 exit 0；`check-gates-ci-column` 明确核对「覆盖率 → ci.yml（test:coverage:packages）」；`check-doc-numbers` 无裸数字断言。
  - YAML：`ci.yml`、`release.yml`、`graph-gate.yml`、`security.yml` 均可解析。
  - 依赖审计：默认镜像的 audit 端点不可用；改用 `--registry=https://registry.npmjs.org` 后 exit 0，4 个 moderate，无 high/critical，低于 `--audit-level high` 门。
- **验证边界**：以上为 Windows 本机结果，不宣称 Ubuntu CI 通过；本轮未推送、未运行 act 本地 CI、未运行 release workflow。覆盖率是防退化门，不等于作者真实路径验收，也不替代发布通过证据。
- **未覆盖**：mcu、mozhou-author-os、mozhou-website 未接覆盖率；未设逐文件阈值；未新增 Playwright E2E 套件。

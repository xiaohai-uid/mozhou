# CHG-20261018-01 — 十层职责基准缺陷修复（D1–D5）与环境治理

- **需求来源**：依据《墨舟工程基准对照审查（第一阶段：只读）》与十层职责对照评审，在有限用户测试前收敛 5 项阻断级工程缺陷（D1 机械门入账判定、D2 引擎超时取消、D3 31 章长程门禁与假 PASS 作废、D4 会话跨重启持久化、D5 任务中心真实接线），并修复工具链环境隐患。
- **观察基线**：HEAD `e2ede76`，分支 `feature/windows-local-release`。
- **范围**：
  - `packages/pipeline/`（状态机、投影、审查执行、草稿流式）
  - `packages/runtime/`（引擎超时传导、AbortSignal 中止通道）
  - `packages/data-plane/`（任务记录清单）
  - `apps/web/server/`（路由层、会话持久化、任务流水）
  - `apps/web/src/`（UI 机械门错误呈现、任务徽标接线）
  - `.github/workflows/longform-nightly.yml`（长程夜跑工作流）
  - `scripts/`（证据脚本卫生、活文档路径与命令核对）
  - `.jscpd.json`（排除 worktrees 假重复）
  - `apps/web/vitest.config.ts`（限制 jsdom 并发 worker，根治 EPIPE）

- **实际变更**：
  1. **D1 机械质量门进入通过判定**：
     - `packages/pipeline/src/projection.ts`：投影新增 `lastMechanicalPassed: boolean | null` 与 `lastMechanicalFails: readonly string[]`；
     - `packages/pipeline/src/session.ts`：新增 `MechanicalGateNotPassedError`；`advance('user_edit')` 严格校验文学审查 `verdict === 'pass'` 且 `lastMechanicalPassed !== false`；
     - `packages/pipeline/src/review-step.ts`：新增 `deriveEffectiveQualityVerdict`，任一机械门不通过直接合并为 `blocking_fail`；审查结果将 `mechanicalPassed` 写入账本事件；
     - `apps/web/server/routes/pipelineRoutes.ts`：顶层返回合并后的 `effectiveVerdict` 及 `mechanicalFailures` 错误详情；
     - `apps/web/src/quality/QualityPanel.tsx`：显式呈现机械门失败项（字数窗口、AI 红线等）；
     - 既有单元测试与集成测试中短草稿用例显式传入 `mechanicalOptions: { minWords: 0 }` 保留原意图；新增 D1 独立负例验证阻断。
  2. **D2 引擎超时取消在途 Provider**：
     - `packages/runtime/src/engine.ts`：`ProviderBinding` 扩展可选参数 `{ signal?: AbortSignal }`；`withTimeout` 超时向绑定传入中止信号；
     - `packages/pipeline/src/draft-step.ts`：新增 `combineAbortSignals`，合并客户端断开信号与引擎超时信号；流式接收与等锁写入点复核 `aborted()`，丢弃迟到 chunk，保证单次结算；
     - `apps/web/server/routes/pipelineRoutes.ts`：将流信号透传给 `streamOpenAiChat`；
     - `packages/runtime/src/engine.test.ts` 与 `packages/pipeline/src/draft-step.test.ts` 新增超时中止与迟到 chunk 丢弃测试。
  3. **D3 31 章长程门禁与假 PASS 作废**：
     - 新建 `.github/workflows/longform-nightly.yml`，设置每日 02:00（Asia/Shanghai）与手动运行；前置检查三个模型 secret，缺失即显式失败；
     - `scripts/check-evidence-hygiene.mjs`：扩展扫描 `evidence/longform-journey/*/summary.json`，若 `status === 'PASS'` 但 `compactionVerified` / `genrePresetVerified` / `restartConsistent` 任一非 true 即判违规；
     - 作废历史两份未经验证卷压缩的假 PASS 证据为 `summary.invalidated.json`，出具 `docs/audit/longform-evidence-invalidation-20261017.md` 作废通报与目录 README。
  4. **D4 服务端会话与重置码跨重启持久化**：
     - 新建 `apps/web/server/auth/sessionTypes.ts`（分离纯类型，彻底消除循环依赖）；
     - 新建 `apps/web/server/auth/sessionStore.ts`：会话与重置码采用 `atomicWriteFileSync` 持久化至数据根 `users/auth-state.json`（权限 0600）；写入操作审计日志 `users/auth-audit.jsonl`，脱敏记录 SHA-256 哈希引用，不落原始 bearer token；
     - `apps/web/server/auth/session.ts`：`SessionManager` 引入持久化存储，启动时由 `productionServer.ts` 在监听前完成回读与过期剪枝；重置码使用后保留消费标记，防止跨重启重放。
  5. **D5 任务中心真实接线与活跃徽标**：
     - `packages/data-plane/src/tasks.ts`：新增 `listTaskRecords`，按更新时间倒序读取全部任务记录；
     - `apps/web/server/routes/worksRoutes.ts`：`/api/works` 与 `/api/tasks` 响应挂载 `taskCount` 与 `taskRecords`；
     - `apps/web/src/shell/useShellTelemetry.ts` 与 `apps/web/src/App.tsx`：接通遥测 `taskCount`，左侧导航工具箱与任务中心动态显示真实任务数；
     - `apps/web/server/routes/systemRoutes.ts`：能力广场将任务中心状态升级为 `native`。
  6. **环境与门禁治理**：
     - 新增 `scripts/check-doc-paths.mjs` 并并入 `ci-gate doc-gates`，对 25 个活文档的引用路径、命令与 WSL 路径做机械校验；
     - 清洗 `apps/web/DESIGN.md` 中 9 处 WSL 绝对路径；对齐 `docs/development.md`、`README.md`、`docs/install.md` 与 `docs/deployment.md` 的桌面栈（Electron 先行，Tauri 为 legacy 死路径）与 Node 版本口径；
     - `.jscpd.json` 显式排除 `"**/.worktrees/**"`，消除 65% 假克隆；
     - `apps/web/vitest.config.ts` 配置 `maxWorkers: 2`，消除 Windows jsdom 并发引发的 `EPIPE` 异常；
     - 更新全局规程 `local-tooling-traps.md` 沉淀 GitNexus 4GB 缓冲池、jscpd 树隔离与 Vitest worker 限制三条定式。

- **验收证据**：
  - 编译：`pnpm build` (`tsc -b`) exit 0。
  - Web 构建：`pnpm --filter @mozhou/web build` exit 0。
  - Web 类型检查：`pnpm --filter @mozhou/web typecheck` exit 0。
  - 依赖无环：`pnpm graph:check` (`cycleCount: 0`) exit 0。
  - 静态导入环：`node scripts/check-import-cycles.mjs` (635 模块 / 1818 边，0 环) exit 0。
  - 证据卫生：`node scripts/check-evidence-hygiene.mjs` (50 脚本无字面量，长程证据无矛盾) exit 0。
  - 构建新鲜度：`node scripts/check-build-freshness.mjs` (产物不落后于源码) exit 0。
  - 文档门：`node scripts/ci-gate.mjs doc-gates` (术语、门清单、包 README、架构图、中英映射、CI 列、裸数字、路径命令) 全部通过 exit 0。
  - 代码克隆：`node scripts/ci-gate.mjs duplication` (2.37% < 17%) exit 0。
  - 主框架走通验收：`node scripts/verify-mock-journey.mjs` 全链路 HTTP 判定 `RESULT: VERIFIED` exit 0。
  - 单元与集成测试：包层 123 文件 / 1095 用例全部通过；Web 层 172 文件 / 1448 用例全部通过（总计 2543 通过，15 跳过，0 失败）。

- **验证边界与未验证项**：
  - 真实 31 章长程模型跑由于无密钥暂处于 BLOCKED，将由 GitHub nightly workflow 在配置 secret 后自动执行；
  - 全量 ESLint 仍被并行会话在途的 `apps/web/server/recycle/*`（未进 tsconfig）拦截，与本次修改无关；针对本次修改的所有文件单独跑 ESLint 均为 0 error / 0 warning。
  - 所有修改当前保留在本地工作区，未执行 git commit / push。

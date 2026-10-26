# CHG-20261012-05 — Electron 桌面壳迁移夜间运行（迁移工具 + 桌面壳）

- 日期：2026-10-12；执行：夜间自动化运行（AI 辅助），晨间报告撰写者复核。
- 需求来源：用户决定「技术栈转为 Electron」，Windows x64 先行；夜间运行据 [ADR-0037](adr/0037-electron-desktop-shell-migration.md) 与 [迁移计划](../plans/2026-10-12-electron-desktop-migration.md) 实现迁移工具与桌面壳，并产出 [迁移格式规范 v1](../specs/browser-data-migration-format-v1.md)。
- 基线：feature/windows-local-release，HEAD `8907eac01c267e96a60025f2bf0e35a98580ef9c`，工作区有未提交改动（32 个受跟踪文件被修改、20 项未跟踪）。**未提交、未合并、未推送**。
- 范围：新增 `apps/web/src/migration/`、`desktop/`、`docs/specs/browser-data-migration-format-v1.md`、`docs/adr/0037-*`、`docs/plans/2026-10-12-*`；未改应用既有业务代码，未新增第三方运行时依赖，未放宽任何门。阶段 4 未通过前不切换默认发行入口、不删旧链路。

## 一、交付物

- **迁移格式规范 v1**：`docs/specs/browser-data-migration-format-v1.md`（210 行）。定义迁移包结构、字段约束、SHA-256 摘要口径（只证完整性不证来源）、导出白名单与纯读规则、导入判定顺序与隔离槽键纪律。
- **迁移工具**：`apps/web/src/migration/`，14 个文件、7 个测试文件。覆盖 8 个实现项：`P1-format`(`packageFormat.ts`)、`P1-export`(`exportLocalStorage.ts` + `browserExportSnippet.ts`)、`P1-probe`(`serverStateProbe.ts`)、`P1-import-plan`(`importPlan.ts`)、`P1-apply`(`applyImport.ts`)、`P1-panel`(`MigrationPanel.tsx`)、`P1-e2e`(`__fixtures__/syntheticBrowserExport.ts` + `migrationFlow.test.ts`)、`P1-format-doc`(上述规范)。
- **Electron 桌面壳**：`desktop/`（`main.mjs`、`lib/{log,paths,port,security,server-process,tray-icon}.mjs`、`scripts/self-check.mjs`）。只做壳：窗口、托盘、单实例、稳定端口、就绪握手、优雅停机、导航与权限边界；服务端仍为独立官方 Node 子进程。
- **决策与计划**：`docs/adr/0037-electron-desktop-shell-migration.md`（已登记 `docs/adr/INDEX.md:95`）、`docs/plans/2026-10-12-electron-desktop-migration.md`。

## 二、实现要点（关键源码位置）

- 迁移身份后缀 = `bookId || root`，与 `apps/web/src/shell/workbenchStorage.ts` 的 `chapterDraftKey` 同源（规范 §1）；键解析以**最后一个**下划线切分，`ch_<N>` 无归属键永不匹配（规范 §3.2、`exportLocalStorage.ts:93`）。
- 摘要：`packageFormat.ts:145` `canonicalStringify`（键字典序）+ `:160` `computePackageDigest`；规范 §2.2 明确摘要只证完整性。
- 导入落地：`applyImport.ts:290` `applyImport`，幂等登记键 `:42`、隔离槽前缀 `:44`（键**必须含包摘要**，否则不同包互相覆盖）；`matched` 空内容计 `noop` 不登记幂等键（规范 §4.4）。
- 桌面安全基线：`desktop/main.mjs:108-119` `nodeIntegration:false` / `contextIsolation:true` / `sandbox:true` / `webviewTag:false`，不设 preload；`desktop/lib/security.mjs` `hardenSession` 收紧导航/新窗口/权限。
- 稳定端口不静默切换：`desktop/main.mjs:193-248`，基准端口被非本数据根实例占用时退出 3，不自动改 origin。
- profile 固定且早于 `app.ready`：`desktop/main.mjs:297-300`（`userData`/`sessionData`/`crashDumps`/`logs`）。

## 三、验证（本轮由晨间报告撰写者实际执行）

**注意：`lint` 退出 1，是失败。** 其余六道门退出 0。

| 门 / 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| lint | `node scripts/ci-gate.mjs lint` | **1（失败）** | 8 个 `Parsing error`，全部来自 `desktop/**.mjs` |
| test:packages | `pnpm run test:packages` | 0 | 122 文件 / 1091 用例；bench 另 1 文件 / 3 用例 |
| web 测试 | `pnpm --filter @mozhou/web test` | 0 | 167 文件 / 1403 用例通过，1 文件 / 15 用例跳过 |
| doc-gates | `node scripts/ci-gate.mjs doc-gates` | 0 | 术语/门清单/README/架构地图/术语映射/裸数字全 PASS |
| graph-check | `node scripts/ci-gate.mjs graph-check` | 0 | `status: clean`、`cycleCount: 0` |
| import-cycles | `node scripts/ci-gate.mjs import-cycles` | 0 | 620 模块 / 1788 条内部边 / 0 环 |
| duplication | `node scripts/ci-gate.mjs duplication` | 0 | 83 克隆，重复行 2.4%（未超阈值） |
| 迁移工具子集 | `pnpm --filter @mozhou/web exec vitest run src/migration` | 0 | 7 文件 / 65 用例通过 |

`lint` 失败根因（可复核）：根 ESLint 为类型化 lint，`allowDefaultProject`（`eslint.config.js:21`）未登记 `desktop/**/*.mjs`，这些文件进不了任何 TS project，被判解析错误。该取舍已在 `desktop/README.md:107` 文档化；本轮**未**执行其建议的修法（`allowDefaultProject` 增 `desktop/**/*.mjs`）。

## 四、独立复核

- 迁移工具复核：**剩余发现 1 条**。
- 桌面壳复核：**发现 4 条**。

如实说明：两组条数来自夜间工作流交办的复核摘要；在仓库内检索（`grep` 关键词、`.scratch/`、`handoff-results/`、`.archify/`）**未找到**可逐条转录的 findings 文件，故本记录只报条数，**未**关闭任何一条。`desktop/README.md:95-110`「已知限制与未覆盖」另有 6 条具体限制（端口段不可绑定、默认数据根不可验证、跨代停止不兼容、托盘交互未断言、根 lint 不覆盖、打包/签名不在范围），但**不据此断言**它们即复核所报的 4 条。

## 五、未验证（unverified）

- **桌面壳自检未复跑**：`desktop/scripts/self-check.mjs`（README 述 23 条断言）本轮未执行；工作区存在 `desktop/.self-check/a-5Zm4W7/`（已清空）仅表明自检曾运行，不构成本轮通过证据。
- **打包 / 安装 / 升级 / 卸载 / 回退**：阶段 3/4 未跑（迁移计划 §4、§5 全表未执行）；`electron-builder`/NSIS、自动更新、代码签名不在本期范围。
- **真实旧浏览器 → Electron 壳**的端到端迁移未在真实环境跑通（迁移工具子集单测通过，不等于真实迁移通过）。
- **真实模型发布门**：需凭据，未接入。
- **默认数据根**（`%LOCALAPPDATA%\MoZhou`）在本机不可写，桌面壳只在 `--data-dir` 路径下验证。
- **跨代停止**：旧 C# 命名 Mutex/Event 停止入口未兼容，`--stop` 仅覆盖本代实例（`desktop/main.mjs:173-191`）。
- **文档同步**：`PROJECT-MAP.md` 只登记 CHG-01..04，**未登记**本次 Electron 迁移；`GLOSSARY.md`/`docs/gates.md`/`README.md` 检索不到 Electron/桌面壳词条（迁移计划 §6 的文档同步属阶段 5，未做）。

## 六、剩余缺口（需用户决定）

- 修复 `lint=1`（登记 `desktop/**/*.mjs`）——本轮未做，根门现为红。
- 关闭复核剩余发现（迁移 1 条、桌面 4 条）——原文不可得，未处置。
- 在隔离干净 Windows 环境跑阶段 3/4（打包、安装、存量迁移、Inno 升级、回退）。
- 迁移未进项目地图/术语表/门清单；未提交、未合并、未推送。

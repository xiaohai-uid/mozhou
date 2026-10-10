# CHG-20261010-11 第九轮复核「声称 vs 现实」审计发现收口

> 触发：第九轮独立对抗复核（verdict `release`，连续第六次；本轮要求它**证伪**上一批两处并**首次系统做「声称 vs 现实」审计**）报出的 1 处文档不实声称 + 1 处文案错误。基线 HEAD `fd4c2e7` → `506a46d`。

## 1. 本轮修完的项（1 个提交）

| 提交 | 内容 |
|---|---|
| `506a46d` | 更正 `apps/web/MOBILE_UI_BRIEF.md` 的版本与测试声称；修正 `desktop-server.mjs` 报错文案里的启动者 |

## 2. 逐项：问题 → 修法

### 2.1 （文档不实声称）`apps/web/MOBILE_UI_BRIEF.md`
**原文**：「墨舟是一款**生产级、可商用**的小说 AI 辅助创作操作系统……（**848/848 项测试全绿**）」

**两处不实**：
- 测试数不符——实测 `pnpm test` 为 **2368 通过 / 15 跳过**（包层 1066 + 台架 3，Web 段 1299 / 15）。
- 「可商用」与根 `README.md` 的定位**直接矛盾**：README 写明当前为**技术预览版 (Technical Preview / v0.3.0)**、**社区免费技术预览版**，且「云同步/云备份、付费许可证激活与正式支付通道尚未作为本 Release 的可用能力发布」。

**修法**：改为与 README 一致的表述（技术预览版 / v0.3.0 / 社区免费，明示本文件不宣称「生产级 / 可商用」），测试规模改为**带日期的实测值**并注明不在此固化数字。

### 2.2 （文案错误）`scripts/release/windows/desktop-server.mjs`
**原文**让用户「用 `MoZhou.exe` 或 `scripts/launcher.mjs` 启动」。核实后：`scripts/launcher.mjs` 是**另一个入口**——它直接启动 `apps/web` 的 `productionServer.js`，**不启动本文件**。真正启动本文件的是 Windows 安装器的 `MoZhou.exe`（`scripts/release/windows/MoZhou.cs:114` 启动，`:127` 设 `MOZHOU_DATA_ROOT`）与 Tauri 桌面壳（`src-tauri/src/server_manager.rs:213` 为服务进程设置该变量）。

**修法**：报错文案改为「the Windows installer MoZhou.exe, or the Tauri desktop shell」；文件头另注明 `launcher.mjs` 不是本入口的启动者，避免以后再写错。**无逻辑变更。**

## 3. 审计的其余结论（干净的，如实记录）

- **代码注释里的强断言逐条核对，未发现与实现不符**：`atomic-write.ts` 的「唯一临时名 → 写全循环 → fsync → close → rename」属实；`styleAnalysis.ts` 的「原子落盘」在上一批改成 `atomicWriteFileSync` 后已属实；`quota.ts` 的「余额 1 时 20 并发仅 1 成功」实测成立（`fulfilled=1`，其余 19 个 `QUOTA_EXHAUSTED`）。
- **`docs/gates.md` 与 `check:gates` 的「已知缺口」与 GAP 逻辑确实只存在于并行会话的未提交改动里**（`git show HEAD` 两者皆无），但 **HEAD 自洽**——干净副本上 `check:gates` / `readmes` / `glossary` / `architecture` / `term-map` 全 EXIT=0，无悬挂引用。
- `release.yml` 已有真校验步骤（祖先判定 + 版本匹配），此前那处「声称无校验」的缺口已闭合。

## 4. 一处「非本提交缺陷」的残余耦合（记录，未改）

第九轮指出：本次修复提供的保证（「单个用户在预算内无法打掉全局断路器」）**依赖「默认月预算 1500 ≤ 全局日预算 10000」这个关系**，而这两个值在生产都**没有 setter 调用**（只有测试会改）。若日后把全局日预算调到小于 1500，单个用户可再次打掉断路器。

本次**未改**（属配置治理，非缺陷）：两个默认值目前都是代码内的固定初值，没有生产路径能改。若将来开放运行期配置，应在那里加一致性校验。已登记。

## 5. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0：包层 119 文件 / **1066 例** + 独占台架段 3 例 + web 段 156 文件 / **1299 例**（15 skipped）——合计 **2368 通过 / 15 跳过**，与本次写入文档的数字一致 |
| `pnpm lint` | exit 0 |
| `node --check scripts/release/windows/desktop-server.mjs` | 语法 OK |
| `pnpm run check:glossary` / `check:gates` / `check:readmes` | 全部 exit 0（readmes 9/9） |
| 干净 HEAD（`506a46d`）副本 | architecture / term-map **FRESH**，glossary / gates / readmes **0** |
| 启动者核实 | `grep -rn "desktop-server.mjs" scripts src-tauri` → 启动方为 `MoZhou.cs:114`（配 `:127`）与 `server_manager.rs`（配 `:213`）；`launcher.mjs` 仅在自己的注释里提到该文件 |

## 6. 仍未修 / 未验证（如实）

- 文档里的测试数仍会随提交变化：本次已注明「以 `pnpm test` 实测为准」并带日期，但**没有**建立自动校验（让某个门去检查文档里的数字）——那属独立改动。
- 「声称 vs 现实」审计**并未覆盖全仓所有文档**，不能读作「所有文档声称都已核实」。
- 第 4 节的残余耦合（月预算 ≤ 日预算）未改。
- 沿用：生产改密不可用且需接口变更（CHG-20261010-09 §3）；真实生成路径仍未接配额；receipt/report 的 `existsSync` 预检仍 TOCTOU；`listUserBooks` 仍是无调用方死代码；被拒绝的预留仍停留 `reserved` 不自动释放；`verifyTicket` 生产无调用方；未连真实 Supabase；Tauri 入口未编译运行；一处未复现的偶发（`quota.test.ts:110`）；`#99` 真模型路径；未推送（未跑 act 本地 CI 门）；安装器未签名；Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）；4 个 moderate 依赖漏洞未修。

## 7. 并发说明（精确暂存）

`apps/web/MOBILE_UI_BRIEF.md` 被并行会话改过**同一行**的一个词（`数据平面`→`数据面`）。我这句是整句重写，故暂存时从 HEAD 版本出发只替换该行、新文案直接使用规范用词；`git diff --cached` 中该文件只有这 1 行改动。`scripts/release/windows/desktop-server.mjs` 动手前干净。生成物无需刷新（与 HEAD 差异为 0），未触碰 `docs/architecture.md` 与 `docs/term-map.md`。

## 8. 回滚

`git revert 506a46d`。回滚后 `MOBILE_UI_BRIEF.md` 会重新声称「生产级、可商用」与「848/848 测试全绿」。

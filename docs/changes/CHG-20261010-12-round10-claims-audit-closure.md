# CHG-20261010-12 第十轮复核「声称 vs 现实」审计收口（7 处文档陈旧声称）

> 触发：第十轮独立对抗复核（verdict `release`，连续第七次；本轮把「声称 vs 现实」审计**做完**）报出的 7 处**文档陈旧声称**——无代码缺陷。基线 HEAD `0102964` → `aa9ce99`。

## 1. 本批修完的项（1 个提交）

| 提交 | 内容 |
|---|---|
| `aa9ce99` | 修正 7 处文档陈旧声称（另加主会话在暂存时发现的第 8 处），涉及 9 个文件 |

## 2. 逐项：陈旧声称 → 实情

| # | 陈旧声称 | 实情（复核依据） | 位置 |
|---|---|---|---|
| 1 | 微信/支付宝「验签降级只由 `NODE_ENV === 'production'` 把关」「非 production 时签名静默穿过验签」 | **已随 R2 修复关闭**：`wechat.ts:94-99` / `alipay.ts:63-67` **无条件 fail-closed**（未配置证书/公钥一律 503），与 `NODE_ENV` 无关，两文件已无该变量引用 | `apps/web/README.md`、`docs/adr/CODE-DUPLICATION-INVENTORY.md` |
| 2 | duplication 门「❌ 未接入」 | 已是 CI 作业：`graph-gate.yml:54-73` | `docs/gates.md:41` |
| 3 | 评估器「运行期不可达…无路由」 | 三条路由可达：`/api/flywheel.suggestions`、`/api/flywheel.evaluator.status`、`/api/flywheel.evaluator.run`（`flywheelRoutes.ts:122,190` + `routePolicies.ts:121-123` + `api.ts:631`）。仅 `confirmRoutingSuggestion` 无生产调用方。另：「`storage.ts` 至今无测试」亦假（`storage.test.ts` 已存在） | `packages/flywheel/README.md` |
| 4 | 「17 项航道 / 17 项能力」、`shell/InkBackground.tsx` 作 WebGL、三栏网格在 `App.tsx` | 实为 23 项导航（`views.ts` 的 `VIEW_COUNT`）；**该组件文件不存在、src 内无 WebGL**（仅 `getContext('2d')`）；三栏网格在 `styles/ink-orbit.css:69` | `apps/web/MOBILE_UI_BRIEF.md` |
| 5 | 具名导出 7 / 26 / 12 | 实为 **8 / 29 / 13**（口径：`grep -c "^export \* from" <pkg>/src/index.ts`，已写进文档） | `packages/{kernel,data-plane,runtime}/README.md` |
| 6 | 测试基线 103 文件 / 910 例；856 / 623 | 2026-10-10 实测：并行段 119 文件 / 1066 例 + 独占台架段 1 文件 / 3 例；web 段 1299 通过 / 15 跳过 | `docs/gates.md:108`、`docs/windows-local-install.md` |
| 7 | （主会话在暂存时发现，复核员与子代理均未覆盖）重复度门「需 `npx` 现场下载 jscpd，**未实跑验证**」 | 已多次实跑并做过红/绿对照：总重复 15.8% < 阈值 17% → exit 0；阈值临时调 0.01 → exit 1 并报 `found too many duplicates` | `docs/gates.md` 实测基线节 |

**为什么第 1 条优先**：它的方向是**低估自身安全性**——会让复核者以为存在一个其实早已修掉的验签绕过漏洞。高估能力危险，低估安全同样会误导判断。

## 3. 一处口径纠正（复核员错、子代理纠正）

复核员称 `MOBILE_UI_BRIEF.md:42` 的「17 项」应为 9。子代理复核后**纠正了这个说法**：技能广场实际消费 `/api/capability-square`（`CapabilitySquareView.tsx:61`），其 `CAPABILITY_SQUARE_GROUPS` **恰为 17 项**；9 项属于**另一个端点** `/api/capabilities`。故该处**保留 17**，只把端点名改对。

这说明：复核结论本身也要复核——本轮就出现了一次「复核员把两个端点的数字对错了」。

## 4. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0：包层并行段 119 文件 / **1066 例** + 独占台架段 3 例 + web 段 **1299 例**（15 skipped） |
| `pnpm build` / `pnpm lint` | exit 0 |
| `node scripts/check-import-cycles.mjs` | `PASS 595 模块 / 1703 边 / 0 依赖环` |
| `pnpm graph:check` | `cycleCount: 0` |
| `pnpm run check:readmes` / `check:gates` / `check:glossary` | 全部 exit 0（readmes 9/9） |
| 干净 HEAD（`aa9ce99`）副本上的五个文档门 | architecture / term-map **FRESH**，glossary / gates / readmes **0** |
| 数字重新实测 | `grep -c "^export \* from"` → 8 / 29 / 13；`pnpm test` → 2368 通过 / 15 跳过 |

## 5. 仍未修 / 未验证（如实）

- **审计仍有残余未核实项**：`flywheel` / `pipeline` / `quality-engine` 的具名导出数（159/194/67）未逐一点算、Tauri 的「<15MB / <40MB」体积声称未实测、`apps/web/README.md` 的行数约数偏小。**不能读作「所有文档声称都已核实」。**
- `MOBILE_UI_BRIEF.md` 第 11 行的「原生 WebGL 着色器」未改：它描述的是**目标技术栈愿景**而非现状（复核员未列入）。
- 文档里的测试数仍**无自动校验**，会随提交漂移。
- 沿用：生产改密不可用且需接口变更（CHG-20261010-09 §3）；真实生成路径仍未接配额；`receipt-file.ts` / `report-store.ts` 的 `existsSync` 预检仍 TOCTOU；`listUserBooks` 仍是无调用方死代码；被拒绝的预留仍停留 `reserved` 不自动释放；`verifyTicket` 生产无调用方；未连真实 Supabase；Tauri 入口未编译运行；一处未复现的偶发（`quota.test.ts:110`）；`#99` 真模型路径；未推送（未跑 act 本地 CI 门）；安装器未签名；Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）；4 个 moderate 依赖漏洞未修。

## 6. 并发说明（精确暂存）

`packages/data-plane/README.md`（1 行 `守卫`→`门`）与 `docs/gates.md`（大面积术语统一改动）被并行会话改过。两者均从 `HEAD:` 版本出发、只替换本轮涉及的行，经 `git hash-object -w` + `git update-index --cacheinfo` 入索引；`git diff --cached` 中他人术语改动行数 **0**。其余 7 个文件动手前干净。生成物无需刷新（本批只改 `.md`）。

## 7. 回滚

`git revert aa9ce99`。回滚后上述 8 处陈旧声称会重新出现（其中两处会重新「低估自身安全性」）。

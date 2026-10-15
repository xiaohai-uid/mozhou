# CHG-20261012-06 — 门禁加固：证据脚本卫生与构建产物新鲜度

- 日期：2026-10-12；执行：ZCode（AI 辅助）。
- 来源：本次会话的 `/retro` 复盘（六条候选，本次做前四条）。
- 基线：feature/windows-local-release，HEAD 8907eac01c267e96a60025f2bf0e35a98580ef9c，工作区有未提交改动。
- 范围：新增两个检查脚本 + 接入 ci-gate 与 pre-commit 钩子 + launcher 告警 + eslint 归属说明。未改产品代码。

## 为什么做

复盘挑出的四类问题都不是「没人知道」，而是「知道但没人拦」，且都在本次会话里真实制造过错误结论：

1. **陈旧构建产物制造假失败**。真实浏览器测作者路径时工作台崩在
   `Cannot read properties of undefined (reading 'toFixed')`，一度被当成产品缺陷。真因是
   `apps/web/dist-server/routes/flywheelRoutes.js` 建于 15:27 而源文件 16:19 才改——产物里新函数
   `preferenceProfileView` 出现 0 次。仓内 `scripts/check-generated-freshness.mjs` 只覆盖
   `docs/architecture.md` 与 `docs/term-map.md`，且按 git 索引判定，而 `dist/` 是忽略项、索引里根本没有。
2. **写死的成功结论**。`scripts/verify-longform-e2e.mjs` 曾有 `status: 'PASS'` 字面量，同时把
   `restartOk` / `compactionVerified` 只记成布尔字段、不进通过条件；历史证据
   `evidence/longform-journey/2026-10-06T13-41-19-856Z/summary.json` 就是 `status:"PASS"` 配
   `compactionVerified:false`。
3. **用短 HEAD 标识源码**。六个脚本用 `git rev-parse --short HEAD`，而仓内
   `scripts/release/lib/source-stamp.mjs` 早已实现「脏工作区加 `-dirty`」的规则（该文件头部记着发布审计
   两次栽在「产物内容与戳的提交不对应」：90b45a1、06a5069）。
4. **新顶层目录的 lint 归属没有规则，且配置里的注释指向错的那条路**。`desktop/**/*.mjs` 产生 8 个解析
   错误；按 `scripts/*.mjs` 先例登记进 `allowDefaultProject` 后变成 186 个类型错误，还把 default project
   的匹配数推过 ts-eslint 的 140 上限，连累 `scripts/` 下两个无关文件报错。

## 实际变更

| 文件 | 变更 |
|---|---|
| `scripts/check-evidence-hygiene.mjs` | 新增。两条规则：禁 `rev-parse --short HEAD`（`source-stamp.mjs` 自身豁免）；禁把成功结论写成字面量 `PASS`。跳过注释行，避免自匹配 |
| `scripts/check-build-freshness.mjs` | 新增。源码目录（`apps/web/{src,server,shared}`、`packages/*/src`、`apps/web/index.html`、`vite.config.ts`）最新 mtime 晚于产物（`apps/web/dist/index.html`、`dist-server/productionServer.js`）最早 mtime ⇒ 陈旧；产物不存在不算陈旧 |
| `scripts/ci-gate.mjs` | 新增两个任务 `evidence-hygiene` / `build-freshness` |
| `.githooks/pre-commit` | 加入 `check-evidence-hygiene.mjs`（秒级文件扫描）。**未加** build-freshness：提交文档不该要求重新构建 |
| `scripts/launcher.mjs` | 产物存在但陈旧时打印告警与重建命令（缺失时仍走原「按需构建」分支） |
| `eslint.config.js` | 补三分支归属判定说明（workspace / scripts 式独立脚本 / 新顶层区域）+ 140 上限这个坑 |
| `docs/gates.md` | 门清单登记两条新门 |

## 验证

- **正向**：`node scripts/check-evidence-hygiene.mjs` → PASS（46 个脚本）；`node scripts/check-build-freshness.mjs` → PASS。
- **反向（证明会拦）**：`touch apps/web/src/App.tsx` 后 `check-build-freshness.mjs` → 退出 1，输出
  `apps/web/src 比 apps/web/dist/index.html 新 1533s` 并给出重建命令；`pnpm --filter @mozhou/web build` 后恢复 PASS。
- 规则边界实测：现存 `status: 'BLOCKED'` / `'FAILED'` / `'VERIFIED'` 字面量**未被误报**——它们在失败分支或
  `try` 断言链内，属控制流派生；只有成功字面量 `PASS` 被禁。
- 全套门禁：`lint` / `evidence-hygiene` / `build-freshness` / `doc-gates` / `graph-check` / `import-cycles` /
  `duplication` 全部退出 0；`test:packages` 与 web 测试（167 文件 / 1403 用例）通过。

## 未做（复盘第 5、6 条）

- `gitnexus impact` 对热点符号过近似（本次对 `exportPromptfooTestCaseFromCanon` 报 CRITICAL / 91 直接调用方，
  实际只有 1 个）：**未改**。该强制条款在 `AGENTS.md` 的 `gitnexus:start/end` 自动生成块内，手工改会被覆盖；
  正解应落在用户级的图层规则里，属仓外文件，需用户决定。
- 客户端把书根绝对路径记在 localStorage（换数据根起服务仍写进旧书根，测试时易误判「数据根是空的」）：**未改**。
  产品行为未必算缺陷（本地优先），只在测试说明里值得点一句。

## 边界

本轮未提交、未推送。

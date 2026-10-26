# Implementation Plan: 作者数据完整性与出站边界加固

**Branch**: `feature/windows-local-release` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-author-data-boundary-hardening/spec.md`

**Note**: 本计划为**事后记录**（实现先于规格与计划），用于把已落地的改动集纳入仓内规格产物并留下验收基线。

## Summary

在既有九包单仓内补三处边界，不新增功能、不迁库、不改作者数据契约：

1. **采纳（正文写入）**：把采纳与取消接入既有书稿写锁；把操作身份校验前置到任何成功出口与副作用之前；把正常完成、幂等回放、崩溃恢复三条出口收敛到同一结果补全逻辑；采纳意图持久化原始操作身份（格式向后兼容）。
2. **事件账本**：发布改为「校验并计算 → 追加 → 提交内存配对状态」；追加失败（结果不明）后停止该实例继续发布；恢复入口先核对账本物理完整性再解除停止。
3. **出站**：取消在第一次等待前绑定并在每个等待点复查；校验与连接使用同一份解析结果（连接固定到已验证地址，保留原域名身份）；响应体按内容编码解码；取消与远端断开的错误分类各自保留。三处出站调用方（模型、爬虫、检索）走同一门。

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24（本机实测 v24.18.0）；pnpm workspace 单仓九包

**Primary Dependencies**: 无新增依赖。出站传输用 Node 内置 `node:https` / `node:http` / `node:zlib`（`undici` 在本仓不是依赖，只有类型包，故不可注入 dispatcher）

**Storage**: 文件系统（书根目录）：`.mozhou/events.jsonl` 事件账本、`.mozhou/accept-intents/` 采纳意图、`.mozhou/operations/` 操作结果、`.mozhou/tasks/` 任务记录、`.mozhou/drafts/` 草稿运行态

**Testing**: vitest（包层 `vitest run` + bench 配置；web 层 `vitest run`）；真实回环 HTTP 用于传输层用例，DNS 与传输通过注入缝替换为内存夹具

**Target Platform**: Windows 本地发行版（`feature/windows-local-release`）；命名管道写锁仅本机固定盘

**Project Type**: 单仓多包（packages/* + apps/web 服务端与前端）

**Performance Goals**: 采纳/取消临界区为本地文件 I/O，短临界区；模型等待不入锁

**Constraints**: 不新增服务、不迁库、不放宽既有安全门、不发布；不改变作者数据契约（仅采纳意图格式向后兼容扩展）

**Scale/Scope**: 改动落在 6 个既有源文件 + 2 个新增模块（`apps/web/server/net/pinnedHttp.ts`、`net/publicTarget.ts`）与 6 个测试文件

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**本门改读 `AGENTS.md` §1–§8（UVSD Protocol v2.2.1 Final）**：`.specify/memory/constitution.md` 自述为未实例化的上游模板（与 `constitution-template.md` 逐字节相同），且 spec-kit 已按 `docs/adr/0031-single-workflow-authority.md` 降级为产物目录，其 `Constitution Check` 门是惰性的——故不引用该模板，也不声称它通过。

| 检查（AGENTS.md §1–§8） | 结果 | 依据 |
|---|---|---|
| §1 范围由已批准的用户旅程决定；不实现未要求的能力 | 通过 | 仅补三处边界；未新增功能 |
| §2 一票一可观察行为；不跨票架构重构 | 通过 | 三个独立切片各自可独立验收 |
| §3 契约冻结；变更须显式 Contract Delta | 通过（有 Delta） | 采纳意图格式 v1→v2 为显式向后兼容扩展；操作身份契约收紧已在 spec FR-003/FR-004 记录 |
| §4 mock 只在开发/测试；生产不静默回落 | 通过 | 出站失败仍走显式错误路径 |
| §5 每项改动带测试；不弱化既有测试 | 通过 | 新增 17 条回归用例，全部在修复前实现上必失败；既有用例未改 |
| §6 非交互模式约束 | 不适用 | 本轮为交互式 |
| §7 项目基建约束（作者数据三原则） | 通过 | 作者决定正文写入 / 旧任务不污染新现场 / 恢复必须验证作者数据——三条正是本轮修复对象 |
| §8 推送前门（graph-check / doc-gates / import-cycles / duplication） | 通过 | 四项门均 exit 0；graph-check `clean` / `cycleCount: 0` |

**Complexity Tracking**: 无违反项。未新增包、未引入新架构层、未新增依赖。

## Project Structure

### Documentation (this feature)

```text
specs/005-author-data-boundary-hardening/
├── spec.md              # 规格（$speckit-specify 产物）
├── plan.md              # 本文件（$speckit-plan 产物）
├── research.md          # Phase 0：本轮真实做过的 7 项技术取舍与备选
├── data-model.md        # Phase 1：7 个实体的字段/校验/状态转移（含两处扩展与一处新契约）
├── contracts/
│   └── draft-accept-and-outbound.md   # Phase 1：端点与出站行为的可观察增量
├── quickstart.md        # Phase 1：可运行的验证步骤与手工观察点
├── checklists/
│   └── requirements.md  # 规格质量清单
└── tasks.md             # 任务分解与执行记录（$speckit-tasks 产物）
```

> 无 `NEEDS CLARIFICATION` 待澄清项；`research.md` 记录的是已作出的取舍而非待研究问题。

### Source Code (repository root)

```text
packages/
├── pipeline/src/
│   ├── draft-accept.ts        # 采纳：身份前置、结果补全、意图 v2、取消入口接锁
│   ├── draft-step.ts          # 生成绑定：候选读改写短临界区 + 锁内复查取消
│   └── draft-accept.test.ts   # 采纳回归用例（含 4 条身份/补全窗口）
│   └── draft-step.lockAbort.test.ts   # 等锁期间取消（新增）
└── runtime/src/
    ├── eventBus.ts            # 发布顺序、停止标记、账本完整性核对
    ├── eventBus.test.ts       # 既有配对/认领用例（未改）
    └── eventBus.append-failure.test.ts  # 追加失败/半行恢复（新增）

apps/web/server/
├── routes/pipelineRoutes.ts   # 采纳/取消路由接书稿写锁；生成绑定注入写锁
├── llm/openaiStream.ts        # 取消绑定时序、地址校验与绑定、流内取消复查
├── llm/openaiStream.cancelBinding.test.ts   # 取消/绑定/端到端（新增）
├── net/pinnedHttp.ts          # 地址绑定传输层 + 内容编码解码 + 中止分类（新增）
├── net/pinnedHttp.test.ts     # 解压与取消分类（新增）
├── net/publicTarget.ts        # 解析+逐条校验共享内核（新增）
├── crawlers/provider-utils.ts # 爬虫逐跳校验 + 连接绑定
├── crawlers/provider-utils.pinned.test.ts   # 逐跳校验（新增）
├── search/provider.ts         # 检索适配器接入同一出站门
└── search/provider.test.ts    # 检索出站门（新增 2 条）
```

**Structure Decision**: 沿用既有九包布局，不新增包。新增的两个模块放在 `apps/web/server/net/`——出站传输与目标校验的公共层，被 `llm/`、`crawlers/`、`search/` 三个调用方共用；`ssrfGuard.ts` 保持纯地址分类器不变。

## 契约 Delta（本轮显式记录）

| 契约 | 变化 | 兼容性 |
|---|---|---|
| 采纳意图记录格式 | v1 → v2：新增可选 `operation` 块（原始操作身份 + 请求摘要） | 读取端同时接受 v1/v2；v1 记录缺少原身份时拒绝绑定新操作 |
| 采纳操作身份校验 | 收紧：意图已存原身份时，请求省略操作标识即拒绝；恢复/回放分支同样过检 | 老客户端（从不带操作标识）不受影响；前端每次带同一标识，回放路径不变 |
| 采纳结果补全 | 正常完成 / 幂等回放 / 崩溃恢复共用补全，结果与任务关联补齐后才返回成功 | 补全逻辑只增不减；结果记录格式版本不变（仍为 1） |
| 事件账本恢复入口 | 新增物理完整性前置：半行或读取失败即保持停止并保留原件 | 完整账本的恢复路径不变 |
| 出站传输 | 新增按内容编码解码；未知编码显式失败；取消分类保留 | 与原生 fetch 的既有可观察行为对齐（协商集合一致） |

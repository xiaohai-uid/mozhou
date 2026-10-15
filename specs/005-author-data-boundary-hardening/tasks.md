---
description: "Task list for 作者数据完整性与出站边界加固"
---

# Tasks: 作者数据完整性与出站边界加固 (005-author-data-boundary-hardening)

**Input**: Design documents from `/specs/005-author-data-boundary-hardening/`

**Prerequisites**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/](./contracts/)

**Tests**: 本特征在规格中把「每个修复窗口都有修复前必失败的回归用例」列为 SC-008，故测试任务为**必需**。

**Organization**: 按 spec.md 的用户故事（US1/US2/US3，优先级 P1/P2/P3）分组，每个故事可独立实现与独立验收。

**执行状态**：T001–T040 为原实施者的事后回填与原检查记录，不能单独作为发行验收。2026-10-12 独立复核另发现运行态归属、压缩取消和 DNS 时限缺口，修复及新检查记录见 `docs/changes/CHG-20261012-01-release-acceptance-closure.md`。下列未验证项仍保留。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无依赖）
- **[Story]**: 所属用户故事（US1 / US2 / US3）
- 描述内含确切文件路径

## Path Conventions

单仓多包：`packages/*/src/`（内核包）与 `apps/web/server/`（服务端）；规格产物在 `specs/005-author-data-boundary-hardening/`。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 本轮新增的公共层与工具登记

- [x] T001 [P] 建立出站公共层目录 `apps/web/server/net/`，承载地址绑定传输层与目标校验内核
- [x] T002 [P] 把新测试目录登记进 lint 白名单（按既有先例逐目录登记）— `eslint.config.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 事件账本的发布与恢复完整性。US1 的崩溃恢复语义与 US2 的现场隔离都以「账本状态可信」为前提。

- [x] T003 发布顺序改为「校验并计算 → 追加 → 提交内存配对状态」— `packages/runtime/src/eventBus.ts`
- [x] T004 [P] 追加失败置「停止发布」标记（结果不明不得按「完全没写」重试）— `packages/runtime/src/eventBus.ts`
- [x] T005 [P] 恢复入口先核对账本物理完整性，半行或读取失败即保持停止并保留原件 — `packages/runtime/src/eventBus.ts`
- [x] T006 验收用例：写前失败可安全恢复 / 毒化后拒绝发布 / 半行拒绝恢复 / EACCES 保持停止 / 完整账本对照 — `packages/runtime/src/eventBus.append-failure.test.ts`（7 条）

**Checkpoint**: 账本在「追加失败 → 停止 → 核对 → 恢复」链条上不再把损坏隐藏为成功。

---

## Phase 3: User Story 1 - 采纳只生效一次、恢复后结果可查 (Priority: P1) 🎯 MVP

**Goal**: 无论重试多少次，正文只写一次、版本只涨一次，且结果与任务关联可查；身份不匹配在副作用前被拒。

**Independent Test**: 隔离书根上对同一候选重复提交同一采纳请求，观察版本增长次数与返回结果；构造「已落盘但结果未记录」现场后重试，观察结果是否可查。

- [x] T007 [US1] 采纳与取消路由接入既有书稿写锁，被占用转 409 `BOOK_WRITE_BUSY` — `apps/web/server/routes/pipelineRoutes.ts`
- [x] T008 [US1] 操作身份校验前置到任何成功出口与副作用之前（含 done 回放与崩溃恢复分支）— `packages/pipeline/src/draft-accept.ts`
- [x] T009 [P] [US1] 采纳意图持久化原始操作身份与请求摘要，读取端兼容 v1/v2 — `packages/pipeline/src/draft-accept.ts`
- [x] T010 [P] [US1] 意图缺少原身份时拒绝绑定新操作 — `packages/pipeline/src/draft-accept.ts`
- [x] T011 [US1] 正常完成 / 幂等回放 / 崩溃恢复共用结果补全，补齐结果与任务关联后才返回成功 — `packages/pipeline/src/draft-accept.ts`
- [x] T012 [US1] 验收用例：done 回放不得绕过身份检查 / 无原身份拒绝绑定 / done 已写结果未写时补全 / 窗口 2 恢复补全 — `packages/pipeline/src/draft-accept.test.ts`（4 条）
- [x] T013 [US1] 验收用例：外部持有写租约期间采纳排队、释放后只生效一次 — `apps/web/server/routes/draftCandidates.test.ts`（1 条）

**Checkpoint**: US1 可独立验收（SC-001 / SC-002 / SC-003）。

---

## Phase 4: User Story 2 - 生成中取消或切章，旧回调不污染新现场 (Priority: P2)

**Goal**: 取消后不再落盘、不再产出已缓冲内容、不再向上游发请求；最终状态不误判为成功。

**Independent Test**: 用确定性排队屏障让写入排队、期间取消再放行，观察候选字节与最终状态；单块含两条内容时取走第一条后取消，观察第二条。

- [x] T014 [US2] 候选读-改-写进书级互斥短临界区，模型等待留在锁外 — `packages/pipeline/src/draft-step.ts`、`apps/web/server/routes/pipelineRoutes.ts`
- [x] T015 [US2] 取得互斥后、落盘前复查取消；等待期间被取消则丢弃待写内容并按「未完成」结算 — `packages/pipeline/src/draft-step.ts`
- [x] T016 [P] [US2] 取消在第一次等待前绑定，并在每个等待点复查 — `apps/web/server/llm/openaiStream.ts`
- [x] T017 [P] [US2] 取消生效后不再产出已缓冲内容，并释放上游连接 — `apps/web/server/llm/openaiStream.ts`
- [x] T018 [US2] 验收用例：等锁期间取消候选字节不变 / 未取消对照 — `packages/pipeline/src/draft-step.lockAbort.test.ts`（2 条）
- [x] T019 [US2] 验收用例（10 条）：启动前取消零请求 / 解析期间取消零请求 / 未取消正常出流 / 连接固定到已验证地址 / 私网解析拒绝零请求 / 空解析拒绝零请求 / 部署者授权本机端点不解析不注入 / 单块内第二条不产出 / 真实回环端到端出流 / 消费方停止迭代释放连接 — `apps/web/server/llm/openaiStream.cancelBinding.test.ts`

**Checkpoint**: US2 可独立验收（SC-004 / SC-005）。

---

## Phase 5: User Story 3 - 出站只连已验证目标、与既有行为兼容 (Priority: P3)

**Goal**: 私网解析被拒且零请求；连接固定到已验证地址且保留原域名身份；压缩内容可读；取消与远端断开分类各自保留。

**Independent Test**: 真实回环服务 + 注入式解析夹具，分别验证拒绝、绑定、解压、错误分类。

- [x] T020 [US3] 新增地址绑定传输层：`lookup` 注入固定已验证地址，保留原域名 Host/SNI/证书校验 — `apps/web/server/net/pinnedHttp.ts`
- [x] T021 [P] [US3] 按响应声明的内容编码解码，流式与整体读取共用同一路径；未支持编码显式失败 — `apps/web/server/net/pinnedHttp.ts`
- [x] T022 [P] [US3] 声明与既有实现一致的压缩协商 — `apps/web/server/net/pinnedHttp.ts`
- [x] T023 [P] [US3] 响应体阶段取消保留中止分类；非取消的远端断开保持网络失败分类 — `apps/web/server/net/pinnedHttp.ts`
- [x] T024 [US3] 抽出「解析 + 逐条校验」共享内核供多调用方共用 — `apps/web/server/net/publicTarget.ts`
- [x] T025 [US3] 爬虫逐跳校验并绑定实际地址 — `apps/web/server/crawlers/provider-utils.ts`
- [x] T026 [US3] 检索适配器接入同一门（配置来源不是可信输入）— `apps/web/server/search/provider.ts`
- [x] T027 [US3] 验收用例：解压 / 压缩流与错误体 / 未支持编码 / 协商头 / 取消分类 / 远端断开 — `apps/web/server/net/pinnedHttp.test.ts`（9 条）
- [x] T028 [P] [US3] 验收用例：私网解析拒绝零请求 / 连接固定到已验证地址 / 重定向逐跳校验 — `apps/web/server/crawlers/provider-utils.pinned.test.ts`（3 条）
- [x] T029 [P] [US3] 验收用例：检索端点私网拒绝零请求 / 连接固定到已验证地址 — `apps/web/server/search/provider.test.ts`（2 条）

**Checkpoint**: US3 可独立验收（SC-006 / SC-007）。

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: 跨故事的质量门与规格产物收尾

- [x] T030 [P] `pnpm build`（`tsc -b`）+ `pnpm --filter @mozhou/web typecheck` 均 0 错误
- [x] T031 [P] `pnpm lint` 无问题
- [x] T032 `pnpm test:packages`：121 文件 / 1081 用例通过（另 bench 3 条）
- [x] T033 `pnpm test:web`：159 文件 / 1324 用例通过（15 skipped）
- [x] T034 [P] `node scripts/ci-gate.mjs graph-check` → `status: clean` / `cycleCount: 0`
- [x] T035 [P] `node scripts/ci-gate.mjs import-cycles` → 602 模块 / 0 依赖环
- [x] T036 [P] `node scripts/ci-gate.mjs doc-gates` → exit 0（架构地图按生成器重建）
- [x] T037 [P] `node scripts/ci-gate.mjs duplication` → exit 0
- [x] T038 GitNexus `detect_changes` → 改动符号全部落在目标文件内；`check` → 无依赖环
- [x] T039 [P] 规格质量清单 `checklists/requirements.md` 全部通过
- [x] T040 [P] 核对 FR-018 约束（不新增依赖 / 不放宽安全门）：`pnpm-lock.yaml` 与各 `package.json` 均无改动、无新增依赖条目；安全门文件（`apps/web/server/ssrfGuard.ts`、`security.ts`、`bookAccess.ts`、`platform/writerLock.ts`）语义未改 — 证据：`git status --short` 对上述路径均无输出

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**：无依赖，可立即开始。
- **Phase 2（Foundational）**：依赖 Phase 1 的目录/登记；**阻塞 US1 与 US2 的恢复语义**。
- **Phase 3（US1）/ Phase 4（US2）/ Phase 5（US3）**：依赖 Phase 2 完成；三者**互相独立**，可并行推进（改动文件不重叠）。
- **Phase 6（Polish）**：依赖所有目标故事完成。

### Within Each User Story

- 实现任务先于其验收用例任务；但本特征为事后回填，二者均已落地。
- 同一文件内的任务不可并行（T008/T009/T010/T011 同在 `draft-accept.ts`；T020–T023 同在 `pinnedHttp.ts`）。

### Parallel Opportunities

- 跨故事并行：US1（`packages/pipeline/` + `routes/`）、US2（`packages/pipeline/draft-step.ts` + `llm/`）、US3（`net/` + `crawlers/` + `search/`）文件不重叠，三人可同时推进。
- 故事内并行：T009/T010（同文件但互不依赖的字段与校验）、T021/T022/T023（传输层内不同关注点）、各故事的用例文件互不相同。

---

## Implementation Strategy

**MVP First**: 仅交付 **US1**（Phase 2 + Phase 3）即构成可用增量——作者采纳不再重复写正文、恢复后结果可查。US2 与 US3 各自独立叠加，不阻塞 US1 验收。

**Incremental Delivery**: 每个故事完成后跑该故事的定点用例 + 该故事涉及的全量包测试；共享边界（`net/`、`eventBus.ts`）稳定后再跑四道门与图谱检测。

---

## 未完成 / 未验证（不在本轮验收范围）

- [ ] T041 真实两进程争用采纳 / 保存 / 取消（当前仅单进程内排队用例）
- [ ] T042 真实进程中断恢复（当前为隔离现场构造）
- [ ] T043 真实模型调用下的取消与恢复（无 API Key）
- [ ] T044 真实 DNS rebinding 攻击验证（当前为注入式解析夹具 + 隔离 HTTPS 域名校验）
- [ ] T045 修复后的完整作者旅程贯通（生成→取消→采纳→保存→冲突→重启）

## 已知残留缺口（已报告，未在本轮授权范围内）

- 账本另有两条不经发布协议的追加路径（领域提交与卷压缩），仍可能把新行写到半行之后；本轮只加固了发布方与恢复方。
- 草稿运行态归属缺口已在独立复核后的修复中处理：候选私有派生状态与章指针分离、锁内认领与归属核对，定点用例已通过；真实进程中断恢复仍未验证。
- `docs/adr/0023` 仍称「账本写入权 = publishEvent 单口」，与该两条追加路径的事实不符；改历史决策记录待定。
- 采纳操作身份的「省略即拒绝」是对既有操作身份契约的扩展，建议补一条 ADR 或给 ADR-0035 加修订说明。

# T3 调研报告：SQLite 访问层选型（裁决 xiaohai-uid/mozhou#5）

- **日期**: 2026-08-24
- **范围**: `@mozhou/data-plane` 的 SQLite 投影索引访问层（真源为 Markdown/JSONL 文件，SQLite 完全可重建；SHA-256 校验独立于本议题）
- **方法**: 一手来源（官方 docs/GitHub/npm registry/维护者讨论），经本地 crawl4ai 与 GitHub API 取证；规格参照 `docs/specs/spec-mozhou-novel-os-2.0.md` Implementation Decisions（L89「SQLite Drizzle/better-sqlite3 投影」，L113 明示斜杠待决）
- **关联原则**: happy-newton 工程原则 #2/#3/#5（最简实现、分层生长、优先成熟库）

---

## 0. 结论先行

**规格书里的「Drizzle/better-sqlite3」不是二选一，而是上下两层**：Drizzle 官方文档明确其 SQLite 方言原生支持三种驱动——`libsql`、`node:sqlite`、`better-sqlite3`[D1]，选 Drizzle（better-sqlite3 驱动）时底层仍是同一个原生模块。真正的裁决维度是「**裸写 vs 加一层 ORM**」与「**社区驱动 vs Node 内置**」。

> **最终推荐：分层组合的"下两层"，暂缓 ORM——**
> **better-sqlite3 直连 + data-plane 内自建薄仓储层（手写泛型行映射）+ `PRAGMA user_version` 投影 schema 版本守卫；版本不符即触发 `rebuildProjectionFromCanon()` 全量重建，不引入增量迁移框架。Drizzle 作为预留演进位（复杂分析型查询出现时叠加 `drizzle-orm/better-sqlite3` 查询构建器，零存储层改动）；node:sqlite 否决为主选（Stability 1.2 + SQLite 版本随运行时固化 + Electron 打包回归先例），但作为长期 fallback 保持关注。**
> 版本策略：锁 better-sqlite3 `^12`（v12 系列每版附带约 140 个预编译产物、含 Electron ABI[N4]；v13 改为 tarball 内置分发且存在未关闭回归[R4][R5]）。

---

## 1. 关键事实澄清

| 事实 | 证据 |
|---|---|
| 三者不在同一抽象层：Drizzle 是查询构建器/ORM，其 SQLite 驱动可以是 better-sqlite3 本身 | Drizzle 官方：「Drizzle has native support for SQLite connections with the `libsql`, `node:sqlite` and `better-sqlite3` drivers」[D1] |
| node:sqlite 于 Node v22.5.0 加入，v23.4.0 / v22.13.0 起**不再需要 `--experimental-sqlite` flag**（官方 API 文档历史表原文：「SQLite is no longer behind `--experimental-sqlite` but still experimental」） | [N1]（历史表）、[N2]（v22.13.0 changelog 中 SEMVER-MINOR commit `55239a48b6`「unflag sqlite module」= PR nodejs/node#55890） |
| node:sqlite 当前稳定性 **Stability: 1.2 – Release candidate**（最新官方文档），API 全部同步（DatabaseSync/StatementSync） | [N1] |
| node:sqlite 的 API 签名大量采纳了 better-sqlite3 的设计（nodejs/node#53264 讨论中双方确认） | [B5]（mceachen 评论） |
| better-sqlite3 自家基准套件已于 2025-07 合入 node:sqlite 对照项（PR #1334） | [B4] |

## 2. 对比矩阵（五维 × 三方案）

图例：**BS3** = better-sqlite3 裸写；**DRZ** = Drizzle ORM(better-sqlite3 驱动)；**NSQ** = node:sqlite。

| 维度 | BS3 裸写 | DRZ（=BS3 + ORM 层） | NSQ 内置 |
|---|---|---|---|
| ① 投影重建批量写入（事务包裹） | ★★★★★ 直接驱动开销最小；事务内批量插入 ~33–41 万行/秒[B2][B3] | ★★★★☆ 同一底层引擎同量级[B3]；ORM 映射层在数十万行的热路径上增加纯 JS 开销[D2]（可用 `db.run` 旁路，但那等于回到裸写） | ★★★★★ 同量级甚至略快（330 vs 400 tx/s @~1000行/tx）[B3] |
| ② 迁移体验 | ★★★☆☆ 手写 `user_version` 版本守卫；但墨舟投影**完全可从真源重建**（spec：`LocalDataPlane.rebuildProjectionFromCanon()`[L1]、测试决策要求 hermetic 隔离库[L2]），schema 演进 ≈ bump 版本号 + 重建，增量迁移框架价值趋近于零 | ★★★★★ drizzle-kit `generate`/`migrate`/`push`/`check` 工具链完整[D3]，`drizzle-orm/better-sqlite3/migrator` 运行时应用已验证存在[D4]；代价是引入 dev 工具链（esbuild/tsx，解包 10MB）[N3]。参考实现项目用 Drizzle 管 31 表/35 迁移运转良好[R8] | ★★☆☆☆ 无任何官方迁移工具；同样只能手写版本守卫 |
| ③ TS 类型安全 | ★★★☆☆ `@types/better-sqlite3`（9KB）提供 API 类型，行结构需手工断言/泛型封装[N3] | ★★★★★ schema 即类型源，select/insert 全链路推导（官方核心卖点）[D1] | ★★☆☆☆ `@types/node` 提供 DatabaseSync 签名，返回值宽类型（unknown 系），全部手工收窄[N1] |
| ④ 依赖体积与原生模块/Electron 风险 | ★★★☆☆ 唯一原生包：解包 26.6MB（源码），deps 仅 node-addon-api[N3]；v12.x 每版附带 ~140 个预编译产物**含 Electron ABI**[N4]；风险集中在安装脚本政策（npm RFC #868 讨论[B6]）与平台二进制错配[R1] | ★★☆☆☆ 在 BS3 之上加 drizzle-orm（纯 JS 10MB、零 deps[N3]）+ 可选 drizzle-kit（dev-only，拖 esbuild/tsx[N3]）；原生风险与 BS3 完全相同（同一 .node 文件） | ★★★★★ 零依赖、零编译、零下载；但把风险转嫁给运行时耦合：SQLite 版本随 Node/Electron 固化[B5]，且 Electron 构建链曾出「No such binding: sqlite」回归[E2][E3] |
| ⑤ 同步 vs 异步 × 本地单用户契合度 | ★★★★★ 同步 API 正合单用户本地负载（README 明言同步在序列化场景反而更优[B1]）；重建可入 worker thread（官方支持[B1]） | ★★★★☆ better-sqlite3 驱动同为同步[D1] | ★★★★☆ DatabaseSync 全同步[N1]；hermetic 测试中 `:memory:` 一行开库[N1] |

三者均支持 WAL、`:memory:`、事务包裹——hermetic 测试要求（临时目录 + 内存/临时库[L2]）全部满足。

## 3. 分维论证

### ① 投影重建批量写入

- better-sqlite3 官方基准（WAL 模式）：**单个事务插 100 行 = 4,141 tx/s ≈ 41 万行/秒**；不加事务逐条插入仅 62,554 行/秒——事务包裹带来 ~6.6× 差距[B2]。
- 第三方现代基准（Ryzen 5950X / Node 26.6 / better-sqlite3 13.0.3，photostructure）：INSERT in Transaction（~1000 行/tx）**better-sqlite3 330 ops/s vs node:sqlite 400 ops/s**，即两者都在 30–40 万行/秒量级；SELECT by PK 120k vs 110k ops/s；大批量物化读取 better-sqlite3 最快[B3]。
- 维护者侧第三方复测结论（mceachen/photostructure）：better-sqlite3 与 node:sqlite「performance is almost indistinguishable」[B5]。
- **推论**：数万行级投影重建在任一方案下都是亚秒~秒级；性能不构成区分度，唯一硬约束是把批量路径锁死在事务内[B2]。异步包装库（node-sqlite3）在同事务基准下慢 15.6×，直接排除[B1]。

### ② 迁移体验

- drizzle-kit 提供完整 generate/migrate/push/check/up/studio 命令面[D3]，运行时经 `drizzle-orm/better-sqlite3/migrator` 应用（unpkg 已验证导出存在[D4]）。
- 但墨舟的架构前提改变了这道题的权重：spec 规定 SQLite 只是**投影**，`rebuildProjectionFromCanon()` 是一等接口[L1]，测试决策强制每次运行用隔离临时库[L2]。**可整体丢弃重建的索引不需要增量迁移框架**——schema 变更的正确处理是「bump `user_version` → 检测不符 → 全量重建」。这消解了 Drizzle 在此维度的最大优势，同时避免为其引入 esbuild/tsx 工具链[N3]。

### ③ 类型安全

- Drizzle 以 schema 推导见长[D1]；但 data-plane 的查询面是有限的仓储形状（按章节取 facts、批量 upsert 投影行），手写 `interface RowX` + 泛型 prepare 包装即可获得同等调用点安全性，成本一次性的。
- node:sqlite 类型最弱（宽返回值，全部手工收窄[N1]）。

### ④ 依赖体积与原生模块/Electron 风险

- 包体（npm registry，2026-08 实测[N3]）：better-sqlite3@13.0.3 解包 26.6MB（deps: node-addon-api）；drizzle-orm@0.45.2 纯 JS 10.2MB（零 deps）；drizzle-kit@0.31.10 解包 10MB（deps 含 esbuild/tsx——dev-only）。
- 预编译供给：v12.x 每个 release 附 ~140 个 tarball，命名覆盖 `electron-v121-*` 等 Electron ABI[N4]；**v13.0.x release assets 为 0**——分发方式改为 npm tarball 内置预编译（伴随 #1491 弃用 prebuild-install 的迁移讨论[B7]），并暴露新问题：Linux 要求 GLIBC ≥ 2.38[B8]、darwin-arm64 Node 20/22 段错误（**仍 open**）[R5]、Windows 仍触发 Python/node-gyp[B9][B10]。
- 安装脚本政策风险：npm RFC #868 拟默认禁用 install script，直接影响一切原生预编译下载（仓库内已有跟踪 issue[B6]）。
- Electron × node:sqlite：Electron 按「偶数版 Node LTS」节奏跟进[E1]；node:sqlite 在 Electron 35 时代还需专门开 flag 的诉求[E4]，随后 E37.2.0 出现「No such binding: sqlite」打包回归[E2]，由四个 fix PR 分别落 main/36-x-y/37-x-y/38-x-y 修复[E3]。**结论：当前主流 Electron 可用，但它证明内置模块在 Electron 构建配置里属于"曾经丢过一次"的面，升级 Electron 时必须回归验证。**
- 本机开发环境特殊风险：本项目在 WSL 下开发、代码位于 `/mnt/c`（Windows 挂载）。vault 已有实证记忆：Windows 全局安装的 better-sqlite3 二进制（PE/COFF）在 WSL Linux node 下 ERR_DLOPEN_FAILED / invalid ELF header[R1]。任何原生方案都受此约束 ⇒ 必须保证 node_modules 按运行平台各自安装（或统一在单一平台跑测试），这一点写进 data-plane 的 CONTRIBUTING 注意事项。

### ⑤ 同步 vs 异步

- 本地单用户场景下 SQLite 的串行性就是天花板，异步包装只增加调度开销：better-sqlite3 README 论证同步 API 在此场景并发性反而更好，并建议 WAL[B1]；node:sqlite 同样全系同步（DatabaseSync）[N1]。
- 数十万行重建放 worker_threads 即可不阻塞 UI（better-sqlite3 官方支持 worker threads[B1]；node:sqlite 亦可在 worker 内使用[N1]）。三案在此维度等价，均合格。

## 4. 最终推荐（含分层组合说明）

```
@mozhou/data-plane
├─ FileStore        Markdown/JSONL 真源 I/O（不变）
├─ Sha256Validator  （不变）
└─ ProjectionIndex  ← 本次裁决点
     driver:  better-sqlite3@^12（唯一原生依赖）
     access:  自建薄仓储层 repository/*.ts（手写 SQL + 泛型行映射）
     schema:  CREATE TABLE IF NOT EXISTS + PRAGMA user_version 守卫
     rebuild: user_version ≠ PROJECTION_SCHEMA_VERSION ⇒ drop + rebuildProjectionFromCanon()
     bulk:    一切批量路径强制 db.transaction(...) 包裹[B2]
【演进位】查询复杂度上来后：+ drizzle-orm/better-sqlite3 查询构建器[D1]，
          存储层零改动（Drizzle 就坐在同一个 better-sqlite3 连接上）
【否决】   node:sqlite 作主驱动（§3④ 三条硬伤）；若未来 Stability 到 2 且
          需要"去原生依赖"，因其 API 与 BS3 同形[B5]，切换成本低，保持观察
```

与工程原则的对齐：#2 最简实现（不预装 ORM 与迁移框架）、#3 分层生长（Drizzle 是预留的上层，不是被否决项）、#5 成熟库（better-sqlite3 是 Node 社区事实标准，连 node:sqlite 都借鉴其 API[B5]）。

## 5. 迁移/落地风险清单

| # | 风险 | 证据 | 缓解 |
|---|---|---|---|
| R1 | WSL↔Windows 平台二进制错配（/mnt/c 共享 node_modules 时 ERR_DLOPEN_FAILED） | vault memory 2026-08-17[R1] | 各平台独立安装依赖；CI 只在单一平台跑 hermetic 套件；文档明示禁止跨平台复用 node_modules |
| R2 | npm 安装脚本政策收紧（RFC #868）阻断预编译下载 | [B6] | 关注 RFC 进展；必要时切 v13 式 tarball 内置分发或 vendor 化 |
| R3 | v13 系列新分发方式的回归窗口：GLIBC_2.38 门槛[B8]、Windows 触发 node-gyp[B9][B10] | 见左 | **锁 `^12`**；升级前复查 release assets 是否恢复 Electron ABI 覆盖[N4] |
| R4 | v13 darwin-arm64 段错误（Node 20/22，open） | [R5] | 同 R3，锁版本即可绕开 |
| R5 | Electron 大版本升级时 better-sqlite3 对应 ABI 预编译缺失 → 需要 electron-rebuild | [N4]（assets 按 electron ABI 出包） | 升级 Electron 的 checklist 加一步：验证对应 ABI asset 存在或本地 rebuild |
| R6 | 若误选 node:sqlite：SQLite 引擎版本随运行时固化，拿不到上游 bugfix；Electron 曾丢 binding[E2] | [B5][E2] | 已否决主选；fallback 复评条件写明（Stability 2 + Electron 稳定供给） |
| R7 | 「版本守卫 + 全量重建」纪律失效：旧索引被静默沿用造成脏读 | 设计固有 | 打开连接即校验 `user_version`，不符立即 fail-fast 并自动触发重建；投影重建幂等性纳入 L1 测试套件[L2] |
| R8 | 批量写入忘包事务 → 性能塌方 6.6×[B2] | [B2] | 仓储层只暴露事务化的 batch API，不给裸循环插入口 |

## 6. 引用来源

**规格/本地**
- [L1] spec-mozhou-novel-os-2.0.md L83/L89/L113（LocalDataPlane 接口、data-plane 职责、斜杠待决声明）（本地文件）
- [L2] 同上 Testing Decisions §3「Zero State Pollution」（本地文件）
- [R1] vault memory《qmd better-sqlite3 is a Windows-native module; WSL node cannot load it》(Obsidian Mind/memories/2026/08/)
- [R8] reference-retrospective-20260823.md L186（参照项目 Drizzle 31 表/40 FK/35 迁移实践）（本地文件）

**better-sqlite3**
- [B1] README（同步 API 论证、基准对照表 15.6×、WAL、prebuilt、worker threads）: https://github.com/WiseLibs/better-sqlite3
- [B2] docs/benchmark.md（4,141 tx/s × 100 行；62,554 行/s 逐条）: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/benchmark.md
- [B3] photostructure/node-sqlite 基准（330 vs 400 tx/s、120k vs 110k select）: https://github.com/photostructure/node-sqlite/blob/main/benchmark/README.md
- [B4] PR #1334 Add node:sqlite benchmark（merged 2025-07-21）: https://github.com/WiseLibs/better-sqlite3/pull/1334
- [B5] Issue #1234 & #1266（API 签名采纳、SQLite 版本固化、"almost indistinguishable"）: https://github.com/WiseLibs/better-sqlite3/issues/1234 , https://github.com/WiseLibs/better-sqlite3/issues/1266
- [B6] Issue #1481 npm RFC #868: https://github.com/WiseLibs/better-sqlite3/issues/1481 ；Issue #1491 prebuild-install 弃用迁移: https://github.com/WiseLibs/better-sqlite3/issues/1491
- [B7] Releases 页（v12.x ~140 assets 含 electron-v121-*；v13.0.x assets=0）: https://github.com/WiseLibs/better-sqlite3/releases
- [B8] Issue #1509 GLIBC_2.38 not found: https://github.com/WiseLibs/better-sqlite3/issues/1509
- [B9] Issue #1503 Windows 触发 Python/node-gyp: https://github.com/WiseLibs/better-sqlite3/issues/1503 ；[B10] Issue #1516: https://github.com/WiseLibs/better-sqlite3/issues/1516
- [R5] Issue #1514 v13 darwin-arm64 段错误（open）: https://github.com/WiseLibs/better-sqlite3/issues/1514

**node:sqlite**
- [N1] Node.js 官方 API 文档 sqlite.html（Added v22.5.0；v23.4.0/v22.13.0 去 flag；Stability 1.2 RC；全同步）: https://nodejs.org/api/sqlite.html
- [N2] v22.13.0 发布说明（unflag sqlite module, PR #55890）: https://nodejs.org/en/blog/release/v22.13.0 , https://github.com/nodejs/node/pull/55890

**Drizzle**
- [D1] Get started with SQLite（三种原生驱动声明、schema 即类型）: https://orm.drizzle.team/docs/get-started-sqlite
- [D2] Transactions/Batch 文档入口: https://orm.drizzle.team/docs/transactions , https://orm.drizzle.team/docs/batch-api
- [D3] drizzle-kit Overview（generate/migrate/push/check/up/studio）: https://orm.drizzle.team/docs/kit-overview
- [D4] drizzle-orm@0.45.2 better-sqlite3 migrator 导出实测: https://unpkg.com/browse/drizzle-orm@0.45.2/better-sqlite3/migrator.d.ts

**npm 体积**
- [N3] registry.npmjs.org latest 元数据（2026-08-24 实测）：better-sqlite3@13.0.3=26,663KB/deps[node-addon-api]; drizzle-orm@0.45.2=10,176KB/deps[]; drizzle-kit@0.31.10=10,026KB/deps[tsx,esbuild,…]; @types/better-sqlite3@9.6.0=9KB

**Electron**
- [E1] Electron Timelines（跟随 Node 偶数 LTS 政策）: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- [E2] Issue #47671「Bug in 37.2.0: No such binding: sqlite」: https://github.com/electron/electron/issues/47671
- [E3] fix PR ×4（main/36-x-y/37-x-y/38-x-y，2025-07-15/16 merge）: https://github.com/electron/electron/pull/47706 , /pull/47755 , /pull/47756 , /pull/47757
- [E4] Issue #45532 Enable node:sqlite in Electron 35: https://github.com/electron/electron/issues/45532

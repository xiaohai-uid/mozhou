# T74 技术底座（Phase 6 · issue #74）

> 状态：定稿 ｜ 研究者：主会话（Wayfinder）｜ 日期：2026-08-27
> 证据纪律：结论带 文件:行号；无代码证据处标【推断】。

## 1. 结论摘要

仓库当前是纯后端 TS 库 monorepo（7 包：kernel/data-plane/context-compiler/runtime/
pipeline/benchmark/flywheel），无 apps/ 层、无 CLI、无任何前端依赖（package.json 根
scripts = build/lint/test；实证）。Phase 6 需要从零起交互界面。

**底座定案（推荐 a+）：apps/web（Vite + React + TypeScript）直引 workspace 包，
无独立后端进程**——理由见 §3。UI 是消费层：全部数据经既有库函数直引读取
（readCanonState/queryActiveFacts/loadReceipt/session API），不建 HTTP API 层
（本地单机、无多客户端、无跨进程需求——建 BFF 是过度设计，UVSD §2 铁律）。

## 2. 现状盘点（实证）

- packages/：kernel, data-plane, context-compiler, runtime, pipeline, benchmark, flywheel
  （ls packages/ 实证；全部 lib 形态、main/dist exports）
- 根 package.json scripts：preinstall/build(tsc -b)/lint/test(vitest)——无 dev server
- 无 apps/ 目录、无 bin/ 入口、无 react/vue/svelte 依赖（grep packages/*/package.json 实证）
- workspace 直引先例：flywheel import pipeline/data-plane（同一包管理模式）

## 3. 底座候选评审

### a) Vite+React 直引 workspace（推荐）
- 交互面完整（Wizard 分步表单/Pro 三面板网格），React 生态成熟
- TypeScript 全栈同构，前端直接 import 库函数与类型——零契约翻译层，
  且 TS compiles all 保证 UI 消费与后端类型同步（UVSD §9 显式类型化契约）
- 本地 dev server（Vite）即 UI 运行形态，生产=静态 build 输出——本地单机定位
  零部署；开发者=用户，调试即使用
- 垂直切片快：建书→首章只需 useState+调用库函数，无网络层

### b) 本地 Node server（HTTP API）+ 前端
- 多一层（server 端点清单+契约同步），单机单用户无收益
- 否决理由：UVSD §2（不实现未被 journey 要求的层）、工程守则 2（最简实现）

### c) 纯终端 TUI
- 交互面受限（分步表单/图景矩阵在 TUI 下体验差），悖离『开发者=用户』的图形偏好
- 否决：Pro Studio 三面板（实体图/矩阵）TUI 表达力不足；后记：若需 CLI 管理
  命令可后补（backlog）

## 4. 接线面

- apps/web → workspace 包直引：Vite 配置 resolve.alias 或 pnpm workspace 自动
- 数据流：UI 组件调库函数（同步读面）+事件账本读面（.mozhou/events.jsonl）
- 写路径全经既有守卫：createBook/ChapterProductionSession/对账 decideItems——
  UI 不新增任何写能力
- 双角色切换=组件路由（React Router 或状态机），共享 bookRoot 上下文

## 5. 最小垂直切片成本

- 『建书→写首章』：apps/web 脚手架（Vite+React+TS, ~10 文件）+ 建书表单（1 组件
  + 调 createBook）+ 首章流（1 组件壳调 ChapterProductionSession 的 compile→commit
  最小调用）+ 状态展示（1 组件读账本）——约 15-20 个新文件、可在一票内完成
- 三面板各一票追加（Story Brain/Context Viewer/Change Matrix），每票 3-6 组件
- V1 全 UI 预计 4 张实现票（T31 底座+切片 / T32 Story Brain / T33 Context Viewer
  +Wizard 完善 / T34 Change Matrix）

## 6. 建议

1. **T31（先发）**：apps/web 脚手架 + 垂直切片『建书→首章→Commit 账本可见』
2. T32/T33/T34 三面板各自独立票（组件只读消费既有读面）
3. 契约纪律：UI 消费走包类型（零 any/裸 map）；面板读面若有缺（如实体关系边
   查询）→ 记缺口回填数据面小票（沿 UVSD §8 停靠上报）

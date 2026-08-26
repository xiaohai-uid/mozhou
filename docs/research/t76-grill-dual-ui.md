# T76 双角色 UI Grilling 终裁记录（Phase 6）

> 主持：主会话（Wayfinder grilling）｜ 日期：2026-08-27 ｜ 状态：终裁定稿
> 输入：t73 用户旅程 / t74 技术底座 / t75 数据契约 三研究 + UVSD 流程纪律
> 基线纪律：研究建议为基线；数值类给定案值；无争议项直接确认不再往返。

## 0. 全局裁定

- 【终裁】UI 是消费层：零新增后端能力；一切写路径经既有 Session/对账守卫
  （t73 §5-5 契约判据为母版）。
- 【终裁】底座 = Vite + React + TypeScript，apps/web 直引 workspace 包，
  无独立后端进程、无 HTTP API 层（t74 §3-a 推荐成立；BFF/TUI 否决并留痕）。
- 【终裁】里程碑：V1 垂直切片 = 建书→世界观→大纲→首章→影响可见 五步全通
  （t73 §5）；V2+ 全部进 backlog（图可视化、实时刷新推送、CLI）。

## 1. 逐项终裁

**D1 底座**
【终裁】批准 a+（t74 §3-a）：apps/web Vite+React+TS 直引；dev server 兼生产静态。
否决 b（HTTP server）与 c（TUI）理由 = 单机单用户无多客户端需求（UVSD §2）；
TUI 表达力不足复述 Pro 三面板。

**D2 旅程范围**
【终裁】批准五步（t73 §2）：建书/世界观/大纲/首章/连写；验收 = 每一步台架确定
性可复现 + 首章产出 ChapterCommitted + 上游改动 Change Matrix 见红。

**D3 面板读写边界**
【终裁】批准全只读（t75 §2-4 各表 only-read 列）；唯一写动作 = 续跑（receiptId）
与重跑遍历（runTraversal），均显示进行态/结果（UVSD §14 失败显式）。

**D4 Change Matrix 装配缺口**
【终裁】批准补齐 assembleChangeMatrix 只读投影（t75 §5-1）——放 data-plane
  packages，一票内完成，UI 只消费该形状；关系图/推送/CLI 进 backlog。

**D5 契约纪律**
【终裁】UI 消费走包类型直引（零 any/裸 map）；面板组件只读渲染；组件测试走
  vitest + 契约快照（面板输入形状与后端类型同步，UVSD §11 契约冻结）。

**D6 票切分**
【终裁】T31 底座+垂直切片（apps/web 脚手架+建书→首章→账本可见）；T32 Story
  Brain；T33 Context Viewer+Wizard 完善；T34 Change Matrix（含 assembleChangeMatrix）。
V1 完成判据 = 四票全绿 + 五步旅程端到端台架 + 契约快照在册。

## 2. 受控增补清单

| # | 增补 | 形态 | 备注 |
|---|---|---|---|
| U1 | assembleChangeMatrix | 只读函数（data-plane） | T34 内联；不进 kernel 词表 |
| U2 | apps/web | 新 workspace 包（Vite+React） | 根 pnpm-workspace 挂载 |

## 3. 否决记录（决策留痕）

- HTTP BFF 层：单机单用户无收益、多一层契约同步（UVSD §2/工程守则 2）
- TUI 专案：三面板交互面表达力不足、悖离图形偏好
- WebSocket 实时推送：本地动作后重读即最新，推送是过度设计（V2 backlog）

## 4. 验收基线

1. T31-T34 四票各自四绿；app 构建产物可静态打开
2. 五步旅程端到端（台架确定性注入）产出 ChapterCommitted 可查
3. 三面板渲染基于包类型契约，零 any；快照测试在册
4. 上游 canon 改动 → 对账 applied → Change Matrix 新红行（端到端）

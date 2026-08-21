# DELTA-001 — 章节正文保存乐观并发（expectedRevision）

**日期**：2026-08-21 ｜ **状态**：已实现（TDD：`tests/http/chapter-conflict.test.ts` 先 RED 后 GREEN）

## 变更原因

商用就绪评审（2026-08-21）判定 PATCH 正文为最后写入胜出：双开标签页/多设备编辑同一章时后保存者静默覆盖先保存者。对写作产品这是付费用户信任级缺陷。schema 已有 `revision` 字段（内容变化自动递增，chat 快照已在用），只差契约层暴露。

## 变更前后

**前**：PATCH `{title?, status?, content?}` 无条件写入。
**后**：增加可选 `expectedRevision: integer ≥0`——携带即强制比较并交换；不一致返回 `409 {error, code:"ContentChanged", chapter}`；未携带保持无条件写入（标题/状态改名不受门控）。

选填而非必填的理由：与 insert 端点 expectedContent 同构；唯一真实客户端（编辑器）永远携带，保护无死角；19 处既有 http 测试零扰动（UVSD #21 不弱化既有测试）。契约文档明示客户端义务：正文保存必须携带。

## 同步修改清单

| 层 | 文件 | 变更 |
|---|---|---|
| 契约 | contracts/openapi.yaml | chapters path 增加 patch 操作 + 409 响应 |
| 契约 | contracts/api-contract.md | 新增第 24 节 |
| Backend | lib/novels/service.ts | updateChapter 增加 opts.expectedRevision，返回 `"conflict"` 联合类型 |
| Backend | app/api/v1/novels/[id]/chapters/route.ts | 校验 expectedRevision；conflict → 409 ContentChanged + 当前行 |
| UI | components/features/chapter-editor-view.tsx | lastSavedRevisionRef 三处维护（GET/PATCH/insert）；saveBody 携带 expectedRevision；409 → 显式报错保留本地文本 |
| Tests | tests/http/chapter-conflict.test.ts | 5 用例（成功递增/409 对账/缺省直写/标题免门控/非法 400） |

## 验证

RED：4/5 用例失败（守卫缺失，200 代替 409/400）→ 实现后全绿；tsc/lint/vitest 全量/e2e 全量随工单收尾复跑。

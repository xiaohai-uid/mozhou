# DELTA-005：章节提交幂等——/api/chapter.commit 增加 expectedRevision + 409 PROSE_REVISION_CONFLICT

日期：2026-09-28　|　触发：`.scratch/mozhou-deepening-20260928/issues/05-commit-idempotency-contract-delta.md`（架构深化工单 05，依赖工单 04 提交编排收口）

## 变更原因

提交端点此前不携带「作者所见版本」：双窗口 / 他端保存之后的过期提交会静默把作者没读过的正文定稿入正典（失败形态是「事后 409」甚至成功）。为提交路径引入与 `/api/chapter.prose.save` 相同的乐观并发守卫，使过期提交在**提取缝（真实模型调用）之前**以 409 拒绝：模型调用增量 0，正文/正典/账本零写入。

## 契约 Delta

| | 现状 | 变更后 |
|---|---|---|
| `POST /api/chapter.commit` 请求 | `{root, chapterIndex, summary, usage?}` | `+ expectedRevision: number` |
| 失配响应 | —（无此状态） | 409 `PROSE_REVISION_CONFLICT` `{expectedRevision, currentRevision, error}` |

**形状照搬已冻结的 `/api/chapter.prose.save` 契约（`packages/data-plane/src/chapter.ts` `SaveProseDraftRequest.expectedRevision` + `ProseRevisionConflictError`），不发明新形状。** 差异仅一处：commit 无新建语义（章必须存在且为 draft），故不收 `null`——必填整数 >= 0。

## 失败语义（依照冻结契约决定）

- 缺失 / 非法（非整数 / 负数 / null / 字符串）→ `400`（动盘之前，同 prose.save「必须在场，杜绝旧客户端静默覆盖」）。
- 盘上无此章 → `404 CHAPTER_MISSING`（不变）。
- 章已 committed → `409 CHAPTER_ALREADY_COMMITTED`（相位守卫仍在 revision 比对之前，工单 02 缺陷 A 语义不变；重复提交/成功响应丢失后重试均落此态，**不视为幂等成功**）。
- 章 draft 但 revision 失配 → `409 PROSE_REVISION_CONFLICT`（新）：提取 0 次调用、零写入。

## 同步修改清单（Schema → UI → Backend → Tests）

1. **Schema/类型**：`packages/data-plane/src/chapter.ts` `CommitChapterRequest.expectedRevision?: number`（undefined=模块内部旧调用方不启用守卫；写路比对在 journal 落盘前，TOCTOU 兜底）；`packages/pipeline/src/commit-orchestration.ts` `RunChapterCommitRequest.expectedRevision: number`（提取缝之前比对）。
2. **Backend**：`apps/web/server/routes/proseRoutes.ts` 解码 + 400 + 409 `PROSE_REVISION_CONFLICT` 映射（与 prose.save :380-388 同形）；两处 `plane.commitChapter` 透传。
3. **UI**：`apps/web/src/quality/QualityPanel.tsx` 定稿请求携带 expectedRevision（面板所读 prose revision）；收到 409 时显式报错并刷新对账，不静默改带新 revision 重发。
4. **Tests**：新增 `apps/web/server/routes/proseRoutes.commitRevision.test.ts`（首次 / 重复 / 过期 / 缺失与非法 / 双窗口 / 成功响应丢失后重试六场景）；既有用例的 commit 请求体按新契约补字段（规则 20b：已批准 Contract Delta 变更客户端义务）。
5. **契约文档**：本文件 + `api-contract.md` 第 26 节 + `openapi.yaml` 登记端点。

## 不做的事

- 不改 `web_commit_ch<N>_rev<R>` 窗口键形状（工单 04 冻结）。
- 不为重复提交引入「幂等 200」：不同输入不视为幂等成功，重复提交仍走相位 409。
- 不改动 prose.save / storyboard.save 既有契约。

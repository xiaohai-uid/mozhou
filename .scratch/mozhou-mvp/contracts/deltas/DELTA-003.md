# DELTA-003：候选确认插入——移除基线相等守卫 + 响应携带 revision

日期：2026-08-22　|　触发：用户实测「第一条插入成功，之后全报错」确诊（诊断报告 .scratch/mozhou-diagnosis-20260822/）

## 变更内容

1. `POST /api/v1/novels/{id}/chapters/messages/{messageId}/insert` **200 响应体新增字段**：
   `chapter.revision: integer`（写入后的章节 revision）。客户端据此推进保存基线
   （此前响应无 revision，客户端基线停在旧值 → 下一次落盘 PATCH 必然 409）。
2. **移除 baseRevision 相等守卫**：候选生成时的章节基线与当前 revision 不再要求严格相等。
   理由：多候选顺序插入是核心工作流，任何一次成功写入都会让同批其余候选永久不可插；
   内容漂移防护由既有三层承担——expectedContent 不一致 → 409 ContentChanged、
   用户 force 二次确认、UPDATE 的 CAS（where revision = 当前值）。守卫属重复设防，
   且 `force:true` 无法豁免它，导致「仍要插入」也永远失败。
3. 409 语义收窄为两种来源：expectedContent 不一致、CAS 竞态失败。错误码仍为
   `{error, code:'ContentChanged'}`，契约面不变。

## 同步面

- openapi.yaml：insert 路径 200 描述补 `{chapter:{content,revision,updatedAt}, messageId, message, qualityGate}`
- 实现：lib/novels/chapter-candidate.ts（canApplyChapterCandidate 删 revision 规则、
  InsertResult + returning 增加 revision）
- 测试：tests/unit/chapter-candidate-lifecycle.test.ts（基线过期改为 ok:true）、
  tests/http/chapter-continuation.test.ts（新增「连续插入两条候选」回归 +
  改写「生成期间正文变化」用例为新语义 + 首插用例断言 revision）

## 兼容性说明

- 无兼容层：客户端此前读取的 `data.chapter.revision` 本就存在（值为 undefined），
  服务端补齐后客户端零改动即恢复正确基线推进。

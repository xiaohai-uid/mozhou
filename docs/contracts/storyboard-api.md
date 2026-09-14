# 墨舟（novel-ai）应用 API 契约 · 漫剧分镜面

> 状态：**现行** | 日期：2026-09-14 | 来源：T02–T04 交付（ADR-0029 前后票）
> 说明：本文件是 novel-ai 应用（`/api/*`，无版本前缀，本地应用无登录态）的分镜 API 真源。
> MVP 时代的 `.scratch/mozhou-mvp/contracts/api-contract.md`（`/api/v1`）是冻结参考，两者不同面。
> 类型真源：`apps/web/server/storyboard/contract.ts`（运行时校验唯一入口）。

## POST /api/storyboard.source
`{root, chapterIndex}` → `200 {ok:true, source:SourceSnapshot, title, characterCount, excerpt}`

- SourceSnapshot = `{bookId, chapterIndex, revision, phase:'draft'|'committed', sha256}`（磁盘原始字节哈希，服务端计算）
- 错误：400 空章/参数非法 · 404 缺章（`CHAPTER_MISSING`）· 400 root 越界（`INVALID_PATH` 等）

## POST /api/storyboard.generate
`{root, chapterIndex, expectedSourceHash, options}` → `200 {ok:true, candidate:StoryboardDocument}`（候选不写盘）

- options = `{aspectRatio:'9:16'|'16:9'|'1:1', targetDurationSeconds:1..3600, visualStyle, language:'zh-CN'}`
- 错误：503 `PROVIDER_UNAVAILABLE` · 409 `SOURCE_CHANGED`（含 currentSourceHash）· 413 `SOURCE_TOO_LARGE`
  · 502 `MODEL_OUTPUT_INVALID|UNANCHORED|OVERSIZE` · 上限：源 12000 字 / 60 镜 / 262144 字节 / 60s 超时 / 单次尝试

## POST /api/storyboard.save
`{root, document, expectedRevision:null|number}` → `200 {ok:true, id, revision, sourceStale}`

- 新建 expectedRevision=null（id 缺省由服务端铸 `sb_<ULID>`）；更新必须等于盘上 revision
- 落盘 `<root>/adaptations/storyboards/<id>.json`（原子替换）；总时长/revision/时间戳服务端重算
- 错误：409 `STORYBOARD_REVISION_CONFLICT`（含 storedRevision）· 404 `STORYBOARD_NOT_FOUND|CHAPTER_MISSING`
  · 400 `STORYBOARD_INVALID`（issues[≤20]）· 500 `STORYBOARD_STORE_ERROR`

## POST /api/storyboards
`{root}` → `200 {ok:true, items:StoryboardListItemDto[], skippedInvalid}`（按 updatedAt 降序；损坏文件如实计数）

## POST /api/storyboard
`{root, id}` → `200 {ok:true, document:StoryboardDocument, sourceStale}`；id 严格 `sb_<ULID>`（路径安全）

**不变量**：改编不修改正文/Canon/质量门/Chapter Commit；书身份、源 hash、路径、id、revision、总时长全部服务端权威；模型输出按不可信 JSON 校验；stale 为派生属性。

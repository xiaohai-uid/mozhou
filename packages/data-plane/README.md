# @mozhou/data-plane

正典文件为真值、SQLite 为可丢弃投影的数据面。

## Owns

- 正典 Markdown/JSONL 的读写（`src/chapter.ts`、`src/canon-read.ts`、`src/yaml-frontmatter.ts`）。
- 投影层：`src/projection.ts` + `src/database.ts`，`PROJECTION_SCHEMA_VERSION = 2`。
- 原子写（`src/atomic-write.ts`）、哈希基线（`src/sha256.ts`）、双平面对账（`src/reconciliation.ts`）。
- 导出（DOCX/EPUB/TXT）与备份。

## Depends on

`@mozhou/kernel`。经 `src/index.ts` 的 29 条 `export * from` 再导出（口径：`export * from` 语句条数；具名导出 0 个）。

## Extension points

- `BookAccessManager` / 书级访问控制。
- 投影重建入口（全量重建以正典为真值确定性重扫，不需模型）。

## Known limitations

- **禁止增量迁移框架**（`src/database.ts:4-7` 明文）。投影靠 `PRAGMA user_version` 守卫，
  版本不匹配即抛 `ProjectionVersionMismatchError`，正确做法是全量重建。
- 29 条 `export * from` 意味着包的实际公开面在子模块里，`index.ts` 自身看不到清单。

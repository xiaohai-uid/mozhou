# @mozhou/kernel

领域内核：schema 与叙事状态。**零依赖**——它是依赖图的根。

## Owns

- 领域 schema（`src/kernel-schema.ts`）与叙事状态（`src/narrative-state.ts`）。
- 因果契约、实体目录等内核类型。

> 术语以 [`GLOSSARY.md`](../../GLOSSARY.md) 为准。本文件只讲包边界。

## Depends on

（无。）这是**有意**的：内核不得依赖任何其他 `@mozhou/*` 包，否则依赖图出现环。

## Extension points

本包**不提供运行时可替换的能力**，它是纯类型与纯函数的领域定义层。经 `src/index.ts` 的 7 条 `export * from` 再导出对外。

没有 `export * from` 会新增对外面的部分——新增导出即新增扩展点，需在 ADR 记录。

## Known limitations

- 再导出意味着 `index.ts` 看不到具名导出清单（`export *` 不被静态分析工具枚举）。
  新增导出时必须同步更新 [`docs/architecture.md`](../architecture.md) 与本文件。
- 因为零依赖，任何「顺手在这里加个工具函数」的改动都会让它变成事实上的公共依赖。

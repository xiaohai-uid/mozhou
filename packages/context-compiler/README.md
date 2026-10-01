# @mozhou/context-compiler

确定性的上下文预算、召回与收据管线。

## Owns

- 两段式上下文装配：故事圣经 + 编译器（`src/assemble.ts`、`src/compile.ts`）。
- 多通道召回：`embeddingRecall`（本地向量）、`khopGraphRecall`（K 跳图）、`detectKeywordTriggers`（关键词快通道），
  由 `mergeChannelsWithRRF` 做 RRF 融合。
- 预算装配与收据（`src/receipt-*.ts`、`src/tokenizer.ts`）。
- **内置本地 embedding 与分词器资产**：`BUNDLED_MODEL_ID`、`createLocalEmbeddingProvider`、`createLocalTokenizer`。

> 术语见 [`GLOSSARY.md`](../../GLOSSARY.md) Part 1 §1.2。

## Depends on

`@mozhou/data-plane`、`@mozhou/kernel`。

## Extension points

- 新增召回通道：实现一个召回函数后交给 `mergeChannelsWithRRF` 融合。
- 模型资产替换：`CreateLocalEmbeddingProviderOptions` 指定自定义模型；默认走内置 `bge-small-zh-v1.5`。

## Known limitations

- **随包携带 24 MB 模型资产**（`assets/models/bge-small-zh-v1.5/`），且每次装载做逐文件 sha256 复核——
  这是秒级成本。`apps/web/server/localEmbedding.ts` 因此做了记忆化包装，避免启动期付出。
- 资产损坏时抛 `ModelAssetsError` / `TokenizerAssetsError`，**不会静默降级**。分词器失效必须响亮失败。
- 本地 WordPiece 计量**不等于**所有模型 tokenizer 的 token 量（见 ADR-0022 与相关文档）。

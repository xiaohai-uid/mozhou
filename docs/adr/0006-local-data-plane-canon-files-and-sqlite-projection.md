# 0006. Local Data Plane: Dual Storage of Human-Readable Canon Files and SQLite Projection

## Context

Pure SQLite or database-only storage destroys human readability, external tool interoperability (e.g., Git, Obsidian, VS Code), and causes catastrophic data loss if database files corrupt. Conversely, pure flat Markdown files cannot support high-performance graph traversals, temporal fact intervals, dependency queries, and fast full-text vector embeddings required for long-form fiction continuity.

## Decision

We adopt a **Dual Storage Model** in the Local Data Plane:

1. **Human-Readable Canon Files (Single Source of Truth)**:
   - All novel chapters, outlines, settings, character profiles, promises, facts, and market briefs are stored in human-readable Markdown and JSON Lines (`.jsonl`).
   - Easily versioned with Git and directly editable in any standard text editor.
   ```
   {BookName}/
   ├── 正文/
   │   └── 第一卷/
   │       └── 第0001章.md
   ├── 大纲/
   │   ├── 总纲.md
   │   ├── 第一卷.md
   │   └── 章节/
   ├── 设定/
   │   ├── 作者意图.md
   │   ├── 人物/
   │   ├── 世界/
   │   ├── 地点/
   │   └── 势力/
   ├── 追踪/
   │   ├── 事实.jsonl
   │   ├── 关系.jsonl
   │   ├── 认知.jsonl
   │   ├── 伏笔.jsonl
   │   └── 时间线.jsonl
   ├── 摘要/
   ├── 文风.md
   ├── 市场/
   │   ├── market-brief.md
   │   └── benchmarks/
   └── .mozhou/
       ├── runtime.sqlite
       ├── events.jsonl
       ├── snapshots/
       ├── indexes/
       └── embeddings/
   ```

2. **SQLite as a Disposable Projection & Execution Index**:
   - Stores fast relational query indexes, temporal fact intervals, dependency edges, vector embeddings, workflow run states, and the append-only event ledger.
   - **Rebuild Guarantee**: If `.mozhou/runtime.sqlite` is lost, corrupted, or deleted, it can be 100% reconstructed by scanning and re-indexing the canonical Markdown and JSONL files.

## Consequences

- The user has total ownership and transparency over their data in standard open formats.
- The runtime operates with sub-millisecond query performance on complex graph and timeline queries.
- Zero vendor lock-in and zero database corruption panic.

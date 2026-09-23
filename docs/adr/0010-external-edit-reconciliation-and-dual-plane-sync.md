# 0010. External Edit Reconciliation and Dual-Plane Synchronization

## Context

In a Local-First environment, authors frequently edit Markdown chapters or JSONL data using external tools (e.g., VS Code, Obsidian, Typora) while MoZhou is offline or running in the background. If the system blindly overwrites external edits, author work is destroyed; if it blindly overwrites the SQLite projection without re-evaluating dependencies, the story graph suffers silent state corruption.

## Decision

We implement a **Hash-Verified Reconciliation Protocol** for external edits:

1. **Content Hashing**: Every `ChapterCommit` and canon file records an SHA-256 hash.
2. **Offline Proposal Generation**: When external file modification is detected via hash mismatch, the system treats the external change as an `EXTERNAL_MODIFIED` offline proposal rather than an immediate canon mutation.
3. **Automated Delta Re-Extraction**: An automated background pass extracts state deltas (fact mutations, relationship changes, promise status) from the externally modified prose.
4. **Author Reconciliation Gate**: The author is presented with an External Edit Reconciliation dialog summarizing detected changes before promoted updates are written to the SQLite index and downstream dependency manifests.

## Consequences

- Authors maintain complete freedom to edit files in any external markdown editor.
- The Story Kernel, temporal fact graph, and dependency tracking are never desynchronized from raw file contents.

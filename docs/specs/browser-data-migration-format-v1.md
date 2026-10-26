# 浏览器数据迁移格式 v1（旧 Edge/Chrome → Electron 壳）

- 状态：**已实现**（前端参考实现见 `apps/web/src/migration/`）。本文件是可独立实现的**规范**，
  供 Electron 导入侧脱离前端代码实现。
- 依据：[`docs/plans/2026-10-12-electron-desktop-migration.md`](../plans/2026-10-12-electron-desktop-migration.md) §3.1
  旧浏览器数据迁移合同、§1.4 localStorage 键清单；[ADR-0037](../adr/0037-electron-desktop-shell-migration.md)。
- 范围：Windows x64 切换发行入口前的存量数据迁移。**不**覆盖浏览器 profile 目录、Chromium 内部存储数据库。

---

## 1. 术语与身份

- **作品身份（identity）**：`{ bookId, root, title }`。`bookId` 为服务端书目 id（优先），
  `root` 为作品根绝对路径（兜底）。**身份后缀 = `bookId || root`**，与
  `apps/web/src/shell/workbenchStorage.ts` 的 `chapterDraftKey` 同源。
- **章条目（chapter entry）**：一个作品内某一章的全部可恢复内容。
- **迁移包（package）**：一次导出的完整 JSON 对象。

## 2. 迁移包 v1 结构

```jsonc
{
  "formatVersion": 1,
  "origin": {
    "origin": "http://localhost:43000",   // 导出页面的 location.origin
    "userAgent": "…",                       // 导出时 navigator.userAgent
    "exportedAt": "2026-10-12T00:00:00.000Z" // ISO 8601
  },
  "books": [
    {
      "identity": { "bookId": "bk_alpha", "root": "C:\\tmp\\alpha", "title": "雾港" },
      "chapters": [
        {
          "chapterIndex": 1,
          "chapterKey": "ch_bk_alpha_1",
          "draft": { "text": "第一章草稿", "baselineSha256": "…64 位十六进制…" },
          "candidate": {
            "candidateId": "cand_alpha_1",
            "base": { "revision": 2, "sha256": "…64 位十六进制…" },
            "mode": "replace",
            "draftText": "候选正文",
            "phase": "draft_done",
            "partial": false
          },
          "editorProjection": { "savedAt": "2026-10-12T00:00:00.000Z", "blocks": [ /* 编辑器结构块 */ ] }
        }
      ]
    }
  ],
  "unclaimed": [
    {
      "key": "mozhou.draft.cache.ch_bk_beta_1",
      "identitySuffix": "bk_beta",
      "chapterIndex": 1,
      "kind": "draft",
      "reason": "identity-not-current-book",
      "raw": "乙书第一章草稿"
    }
  ],
  "preferences": { "mozhou.wizard.done": "done" },
  "digest": "…64 位十六进制…"
}
```

### 2.1 字段约束

| 字段 | 约束 |
| --- | --- |
| `formatVersion` | 整数，本版本恒为 `1`；其它值 → `FORMAT_VERSION_UNSUPPORTED` |
| `origin.origin` / `origin.exportedAt` | 必填字符串 |
| `origin.userAgent` | 字符串；缺失按空串处理 |
| `books[].identity` | `bookId` 与 `root` 至少一个非空（否则身份不明 → 拒绝） |
| `chapters[].chapterIndex` | ≥ 1 的整数 |
| `chapters[].draft` | `null` 或 `{ text: string, baselineSha256: string \| null }`；`baselineSha256` 为**保存基线**，缺失（旧缓存）为 `null` |
| `chapters[].candidate` | `null` 或对象；`base.revision` 为 ≥ 0 整数、`base.sha256` 为字符串，**必须原样保留** |
| `chapters[].editorProjection` | `null` 或 `{ savedAt: string, blocks: unknown[] }` |
| `unclaimed[]` | 白名单键中身份不明/无法解析的条目；`kind ∈ {draft, baseline, candidate, projection, workbench, preference}` |
| `preferences` | 字符串到字符串的映射（应用级偏好，如 `mozhou.wizard.done`） |
| `digest` | 见 §2.2 |

### 2.2 内容摘要（digest）

1. 取包中**除 `digest` 外的全部字段**为载荷 `payload`。
2. `canonical(payload)`：递归规范化 JSON —— 对象键按字典序排序，数组保持顺序，
   `null`/布尔/数字/字符串按 JSON 编码。
3. `digest = SHA-256(UTF-8(canonical(payload)))`，小写十六进制。

校验时对「除 `digest` 外的原始输入字段」重算并逐字比较；不一致 → `DIGEST_MISMATCH`。
校验器容忍实现方附加的未知字段（它们同样进入摘要），只证明内容未被改动。

> **边界（合同 §3.1）**：SHA-256 摘要只证明**完整性**，**不证明来源认证**。
> 任何自洽（自算摘要）的包都会通过校验；导入侧不得把「摘要匹配」当作「内容可信」。

## 3. 导出侧规则（在旧浏览器页面内）

1. 通过 `localStorage.length` + `localStorage.key(i)` **枚举**真实存在的键（不得只按已知键取值）。
2. 只处理**白名单**键；白名单外的键一律不进包。
3. 按身份后缀归属章节：身份后缀 = 当前 `mozhou.workbench.v1` 记录的 `bookId || root`。
4. **旧版无归属键** `ch_<N>`（只有一个下划线）**永不匹配**，不进包（保留在源端供手动导出）。
5. 身份后缀存在但不对应当前作品（或当前作品未知）→ 进 `unclaimed`，**不分配给任何作品**。
6. 纯读：不得修改或清空源端任何键。

### 3.1 白名单键

| 键 | 内容 | 迁移到 |
| --- | --- | --- |
| `mozhou.workbench.v1` | `{ book: { root, bookId, title }, view }` | 作品身份来源（不原样入包） |
| `mozhou.draft.cache.<ch_<identity>_<N>>` | 草稿纯文本 | `chapters[].draft.text` |
| `mozhou.draft.baseline.<ch_<identity>_<N>>` | 草稿基线 SHA-256 | `chapters[].draft.baselineSha256` |
| `mozhou.candidate.cache.<cand_<identity>_<N>>` | 候选缓存（含 `base.revision/sha256`） | `chapters[].candidate` |
| `mozhou.editor.projection.<ch_<identity>_<N>>` | `{savedAt, blocks}` 编辑器投影 | `chapters[].editorProjection` |
| `mozhou.wizard.done` | 首次向导完成标记 | `preferences` |
| `mozhou.scene.v1` | 场景偏好 | `preferences` |
| `mozhou.skills.active` | 已注入技能 | `preferences` |

### 3.2 章键解析

- 草稿/基线/投影：前缀 `mozhou.draft.cache.` / `mozhou.draft.baseline.` / `mozhou.editor.projection.`，
  后缀形如 `ch_<identity>_<N>`。
- 候选：前缀 `mozhou.candidate.cache.`，后缀形如 `cand_<identity>_<N>`。
- 解析：以**最后一个**下划线切分 —— 左侧为身份后缀（允许含下划线，如 Windows 路径），
  右侧为 ≥ 1 的十进制整数章号。若切分点不存在、身份为空或右侧非正整数 → 视为**无归属键**（不进包）。

## 4. 导入侧规则

### 4.1 逐条判定

| 判定 | 条件 |
| --- | --- |
| `unclaimed` | 条目身份不属于目标作品（或目标作品未确定）→ 进**待认领区**，不写任何作品槽位 |
| `duplicate` | 幂等键已在「已迁移」登记表中 → 跳过，不产生副作用 |
| `conflict` | 与服务端现状或本地现状不一致 → **保留双份、不覆盖** |
| `matched` | 以上皆非 → 写回既有槽位 |

判定顺序：`unclaimed` → `duplicate` → `conflict` → `matched`。

### 4.2 冲突判据

服务端**不可达**（探针失败）时不得推断「服务端为空」→ 保守判 `conflict`。服务端可达时：

- 有候选且 `candidate.base.revision !== 服务端 revision` → 冲突（候选基于过期版本）；
- 有草稿基线且 `draft.baselineSha256 !== 服务端正文 SHA-256` → 冲突（本地草稿偏离服务端）；
- 服务端 `phase === "committed"` 且包内有草稿或候选 → 冲突（会覆盖已定稿）。

本地（目标壳内）已有草稿且文本与包内草稿不同 → 冲突（不覆盖本地）。文本相同但**保存基线不同**
（`local.baselineSha256 !== draft.baselineSha256`）→ 同样冲突：落地会把本地基线改写成包内基线，
静默翻转「已保存/未保存」标记。本地已有**不同 AI 候选**或**不同编辑器投影**（blocks 不等）→
同样判冲突（不变量 1 保护 AI 候选与编辑器结构）；两者与包内一致时不误判冲突。

服务端现状经既有端点读取，**不新增接口**：`POST /api/chapter.prose`（`exists/revision/phase/body`）
与 `POST /api/book.state`（作品存在性）。逐章探针必须用**目标作品根**（壳内实际作品），
不得用包内记录的 `root`：包内 `root` 与目标不一致时，用包内 `root` 会查到另一个（可能不存在的）
路径，与作品存在性探针的结论自相矛盾。非目标作品的条目一律 `unclaimed`，不参与冲突判定。

### 4.3 幂等键

```
idempotencyKey = <package.digest> + "::" + <identitySuffix> + "::" + <chapterIndex>
```

包级待认领条目：

```
idempotencyKey = <package.digest> + "::unclaimed::" + <unclaimed[].key>
```

### 4.4 落地与隔离

- `matched` → 写回既有槽位（键纪律 = `bookId || root` 身份）：
  - 草稿 `mozhou.draft.cache.<ch_<identity>_<N>>`（**空文本不写也不删**：包内只有基线、无草稿时
    不得 `removeItem` 目标槽，避免删掉壳内既有草稿）
  - 基线 `mozhou.draft.baseline.<ch_<identity>_<N>>`（**保真**：草稿与基线不一致时原样写入基线，
    不得重算为 `sha256(text)`）
  - 候选 `mozhou.candidate.cache.<cand_<identity>_<N>>`（`base.revision/sha256` 原样保留）
  - 投影 `mozhou.editor.projection.<ch_<identity>_<N>>`
- `conflict` / `unclaimed`（章条目）→ 隔离槽
  `mozhou.migration.quarantine.v1.<digest>.<verdict>.<identitySuffix>.<chapterIndex>`，**不覆盖原槽**。
  键**必须含包摘要**：否则两个不同包对同一 `(verdict, identity, chapterIndex)` 会写进同一键，
  后到的静默覆盖先到的，而先到的包因幂等键已登记、重导被判 `duplicate` 而跳过，其隔离副本
  永久不可恢复（合同「保留双份」失效）。
- 包级待认领 → 隔离槽
  `mozhou.migration.quarantine.v1.<digest>.unclaimed.<identitySuffix|no-identity>.<chapterIndex|na>.<kind>`。
- 每次写入必须**回读确认**；只有确认成功才把幂等键记入登记表
  `mozhou.migration.applied.v1`（`{ [digest]: { appliedAt, keys[] } }`）。
- 判为 `matched` 但**无内容可写**（章条目全空：`draft={text:"",baselineSha256:null}` 且无候选/投影）
  的条目计入 `noop`，**不计入 written、不登记幂等键**——报告必须与实际写入一致。
- **失败不清空源端**：落地过程从不删除源端键，也不删除目标槽既有键；失败条目保留在计划中可重试。
- **重复导入无副作用**：全部条目为 `duplicate` 时不得写入任何键（包括作品状态
  `mozhou.workbench.v1`）。

### 4.5 目标作品登记

目标作品未在 `mozhou.workbench.v1` 记录时，导入可登记之；已有作品选择**不覆盖**。
仅在本次确实有写入（存在非 `duplicate` 条目，或有未登记的待认领条目）时才登记——
重复导入（全部 `duplicate`）不得产生任何副作用。

## 5. 参考实现与验证

| 关注点 | 文件 |
| --- | --- |
| 类型与校验器 | `apps/web/src/migration/packageFormat.ts` |
| 导出器 | `apps/web/src/migration/exportLocalStorage.ts` |
| 控制台片段（可粘贴、自成一体） | `apps/web/src/migration/browserExportSnippet.ts` |
| 服务端现状探针 | `apps/web/src/migration/serverStateProbe.ts` |
| 导入决策 | `apps/web/src/migration/importPlan.ts` |
| 导入落地 | `apps/web/src/migration/applyImport.ts` |
| 入口面板 | `apps/web/src/migration/MigrationPanel.tsx` |
| 合成样本 | `apps/web/src/migration/__fixtures__/syntheticBrowserExport.ts` |

验证入口：`npx pnpm --filter @mozhou/web exec vitest run src/migration`。

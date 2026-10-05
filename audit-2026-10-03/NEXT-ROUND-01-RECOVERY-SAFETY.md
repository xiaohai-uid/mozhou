# 墨舟 (MoZhou / Novel OS) 技术规格说明书
# 阶段一：书稿与提交恢复安全一致性模型设计
# (NEXT-ROUND-01-RECOVERY-SAFETY.md)

- **文档类型**：系统架构与持久化一致性恢复技术规格说明书 (Technical Specification)
- **基线版本**：HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb` / WORKTREE(42项未提交改动)
- **责任模块**：`@mozhou/data-plane` (`packages/data-plane/src/chapter.ts`, `packages/data-plane/src/local-data-plane.ts`)
- **关联缺陷**：`FINDINGS.md` F-01 (CRITICAL)
- **编制依据**：`audit-2026-10-03` 全量审计证据、`06-verification-log.md` (probe-07 实测日志)、`07-crosscheck-review.md` 驳回项裁决

---

## 一、 问题背景与审计发现校正

### 1.1 缺陷背景
在墨舟的两阶段提交（2PC Chapter Commit）机制中，`packages/data-plane/src/chapter.ts` 规定以**正文 Markdown frontmatter 相位从 `draft` 翻转为 `committed`** 作为唯一线性化点（Linearization Point）。
当发生系统崩溃或异常退出时，`LocalDataPlane.open()` 或 `openOrRebuild()` 会首先调用 `recoverPendingCommit(root)`。若正文哈希匹配 `journal.stagedProseSha256`，说明线性化点已越过，状态机必须执行**前滚恢复（`recoverForward`）**，补齐追踪流增量、SQLite 投影与基线清单。

### 1.2 审计探针的复核校正
在先前审计阶段，关于该缺陷的描述存在两项不严谨之处，现正式予以校正：
1. **校正表述语境**：严禁使用“二次断电导致数据永久丢失”的绝对化推断。探针（`probe-07` / `logs/038`）是在隔离文件系统上通过应用层异常注入与文件截断模拟的盘面崩溃，并非物理硬件断电实测；更重要的是，即便 Markdown 追踪流增量未补齐，**若提交在崩溃前已完成过 projection 阶段，SQLite 投影库中仍存有 `tracking_lines` 副本**。但由于正典原则规定“Markdown 文件才是唯一事实源，SQLite 随时可丢弃”，一旦正典文件缺失，删库重建（`rebuildProjectionFromCanon`）时数据将真正不可逆丢失。
2. **校正事件流物理路径**：在复核 `probe-07` 代码时，纠正其对 `.mozhou/runtime_events.jsonl` 的错误假定，正典事件流常量在 `packages/data-plane/src/layout.ts:11` 中严格定义为 **`.mozhou/events.jsonl`**（常量名 `RUNTIME_EVENTS_PATH`）。

### 1.3 核心技术矛盾
审查既有 `recoverForward` 实现（`chapter.ts:379-385`）：
```ts
for (const { target, disk } of diskStates) {
  const classified = classifyAppendDiskState(disk, target)
  if (classified.state === 'partial') {
    truncateSync(join(root, target.relPath), target.baseBytes)
    appendFileSync(join(root, target.relPath), Buffer.from(target.payloadBase64, 'base64'))
  }
}
```
**矛盾根因**：
- 当目标文件处于 `partial`（写入了一半）时，恢复流程执行了物理截断（`truncateSync` 退回到 `target.baseBytes`），试图再通过 `appendFileSync` 重放补齐。
- 若系统恰好在 `truncateSync` 执行完毕、尚未完成 `appendFileSync` 时再次异常崩溃，盘面目标文件大小变为 `size === target.baseBytes`。
- 下一次重启时，`classifyAppendDiskState` 按照 `size === target.baseBytes` 直接判定为 **`state: 'untouched'`**。
- `recoverForward` 仅对 `'partial'` 执行修复，对 `'untouched'` 视作无须处理；随后代码顺利执行投影插入、更新 manifest，并调用 `unlinkSync(journalPath)` 删除了 `pending-commit.json`。
- **后果**：正文处于 `committed` 终态，预写日志被物理销毁，而正典追踪流文件根本没有补入该次定稿的事实增量！

---

## 二、 恢复安全一致性不变量 (Recovery Consistency Invariants)

本规范坚决拒绝使用“增加临时 marker 状态文件”的脆弱修补方案（标记文件自身同样面临未刷盘、丢失、二次崩溃孤儿残留的级联问题）。恢复模型必须建立在**无状态、纯盘面自洽、基于前滚前置不变量的数学自愈闭环**之上。

系统必须严格满足以下四大不变量：

### 不变量 INV-REC-1：前滚终态自洽不变量 (Forward Terminal Convergence)
在正文相位已翻转为 `committed` 的前提下，无论发生多少次系统崩溃或恢复打断，最终收敛状态必须保证：
$$\forall \text{target} \in \text{journal.appends}, \quad \text{DiskState}(\text{target}) = \text{'done'}$$
即：所有在 `PendingCommitJournal` 中登记的追踪流和事件流，必须**完整且逐字节**追加了预写载荷 `payloadBase64`。只要存在任何一个 target 不处于 `'done'`，绝对不允许删除 journal，绝对不允许宣告恢复完成。

### 不变量 INV-REC-2：盘面混合状态单调吸收不变量 (Monotonic Mixed-State Ingestion)
对于单次提交涉及的多个追加目标 $T_1, T_2, \dots, T_k$，盘面可能呈现任意混合状态：
- 目标 $T_a$：`'done'`（已完整写入）
- 目标 $T_b$：`'partial'`（截断在载荷中段）
- 目标 $T_c$：`'untouched'`（大小恰好等于 `baseBytes`）

**前滚判定准则**：
1. 正文已是 `committed` 态 $\implies$ **本次提交的业务意图是前滚（Forward）**；
2. 若目标状态为 `'untouched'`，在正常前滚语境下，它并不意味着“已完成”，而是意味着**“该目标尚未开始追加，或在上一轮恢复截断后尚未追加”**；
3. 因此，在前滚恢复流程中，**`'untouched'` 必须与 `'partial'` 同样被视作待重放目标**！
4. 唯有当状态为 `'done'` 时，才允许跳过追加。

### 不变量 INV-REC-3：恢复操作自身幂等可重入不变量 (Recovery Idempotency & Reentrancy)
恢复函数 $R(\text{DiskState})$ 必须是一个数学上的幂等算子：
$$R(R(\text{DiskState})) = R(\text{DiskState})$$
无论恢复过程在任何一行代码（包括 I/O 调用中途）发生异常崩溃，下一次执行 $R$ 必须产生与连续执行完成完全一致的物理盘面，绝不产生数据重复追加，绝不产生数据遗漏。

### 不变量 INV-REC-4：双平面确定性对齐不变量 (Dual-Plane Alignment)
恢复完成后：
1. **Markdown 正典面**：正文为 `committed`，五族追踪流 `追踪/*.jsonl` 与事件流 `.mozhou/events.jsonl` 包含对应行；
2. **SQLite 投影面**：`tracking_lines` 包含对应 `seq` 的投影行，与正典追踪流逐行哈希一致；
3. **基线清单面**：`.mozhou/manifest.json` 记录所有被触文件的最新 SHA256，且盘面文件无任何外部未登记修改；
4. **重建等价性**：在此状态下，执行 `rebuildProjectionFromCanon(root)` 重建的 SQLite 数据库，其内容哈希与当前 SQLite 投影必须 100% 相同。

---

## 三、 状态机转移与判别准则设计

### 3.1 盘面追加目标三分法状态定义
目标文件物理大小 $L$，日志基线大小 $B = \text{target.baseBytes}$，载荷大小 $P = \text{length}(\text{payload})$。

```text
[0 ----------------- B ----------------- B+P]
                     |                    |
        untouched    |      partial       |   done
       (L === B)     |    (B < L < B+P)   | (L === B+P)
```

| 盘面状态 | 物理特征 | 字节校验条件 | 回滚恢复 (Backward) 动作 | 前滚恢复 (Forward) 动作 |
|---|---|---|---|---|
| **`untouched`** | $L = B$ | 文件末尾无多余字节 | **无须动作 (Skip)** | **必须完整追加载荷 (Append Payload)** |
| **`partial`** | $B < L < B+P$ | 偏移 $B$ 之后的前缀字节与载荷完全匹配 | **截断至 $B$ (Truncate)** | **截断至 $B$ 并追加载荷 (Truncate + Append)** |
| **`done`** | $L = B+P$ | 偏移 $B$ 之后的字节与载荷 100% 一致 | **截断至 $B$ (Truncate)** | **无须动作 (Skip)** |
| **`conflict`** | 其它任意状态 | 长度 $< B$，或后缀字节与载荷失配，或长度 $> B+P$ | **抛出 `PendingCommitConflictError` 拒绝恢复** | **抛出 `PendingCommitConflictError` 拒绝恢复** |

> **关键架构决策对比**：
> - **既有实现缺陷代码**：在前滚时，仅检查 `if (classified.state === 'partial')`。
> - **新规约判定法则**：在前滚时，状态分支为：
>   ```ts
>   if (classified.state === 'done') {
>     continue; // 真正已完成，幂等跳过
>   }
>   if (classified.state === 'partial' || classified.state === 'untouched') {
>     if (classified.state === 'partial') {
>       truncateSync(path, target.baseBytes);
>     }
>     appendFileSync(path, payload);
>   }
>   ```
> - 这样无论是首次崩溃前根本未追加（`untouched`），还是恢复过程中截断后被二次打断（再次变为 `untouched`），恢复逻辑都会确定性地执行重放追加，确保载荷绝对不会被遗漏！

---

## 四、 完备恢复算法伪代码与规范

基于上述不变量，重构 `recoverPendingCommit` 与 `recoverForward`。

### 4.1 核心恢复主入口规范 (`recoverPendingCommit`)
```ts
export function recoverPendingCommit(root: string): void {
  const journal = readJournalIfExists(root)
  if (journal === null) {
    return
  }

  // 1. 验证目标文件存在性
  for (const target of journal.appends) {
    const disk = readDiskOrNull(root, target.relPath)
    if (disk === null) {
      throw new PendingCommitConflictError(target.relPath, 'journaled target file is missing on disk')
    }
  }

  const proseRaw = readDiskOrNull(root, journal.proseRelPath)
  if (proseRaw === null) {
    throw new PendingCommitConflictError(journal.proseRelPath, 'prose file went missing during pending commit')
  }
  const proseSha = sha256Hex(proseRaw)

  // 2. 依据正文哈希（线性化点）裁决恢复方向
  if (proseSha === journal.stagedProseSha256) {
    // 线性化点已过：正文已处于 committed 态，执行绝对前滚
    recoverForward(root, journal)
    return
  }
  if (proseSha === journal.originalProseSha256) {
    // 线性化点未过：正文仍处于 draft 初始态，执行绝对后滚
    recoverBackward(root, journal)
    return
  }

  // 3. 正文哈希失配：外部并发篡改或灾难性破坏，Fail-Closed
  throw new PendingCommitConflictError(
    journal.proseRelPath,
    'prose file matches neither journaled anchor — external edit raced a crash window',
  )
}
```

### 4.2 完备前滚实现规范 (`recoverForward`)
```ts
function recoverForward(root: string, journal: PendingCommitJournal): void {
  // 步骤 1：全量收敛所有追加流至 'done' 终态
  for (const target of journal.appends) {
    const filePath = join(root, target.relPath)
    const disk = readFileSync(filePath)
    const classified = classifyAppendDiskState(disk, target)

    if (classified.state === 'done') {
      // 目标已处于最终状态，幂等放行
      continue
    }

    if (classified.state === 'partial') {
      // 目标处于半写损坏状态：先安全退回 baseBytes
      truncateSync(filePath, target.baseBytes)
    }

    // 此时盘面确定处于 baseBytes 偏移：重放追加全量载荷
    const payload = Buffer.from(target.payloadBase64, 'base64')
    appendFileSync(filePath, payload)

    // 追加后防御性即时重检：保证物理刷入无误
    const recheckDisk = readFileSync(filePath)
    const recheckClassified = classifyAppendDiskState(recheckDisk, target)
    if (recheckClassified.state !== 'done') {
      throw new Error(`CRITICAL_IO_FAILURE: failed to forward target ${target.relPath} to 'done' state`)
    }
  }

  // 步骤 2：幂等对齐 SQLite 投影数据库
  // 无论先前是否部分插入，INSERT OR IGNORE 保证结果完全一致
  if (journal.appends.some((target) => target.kind !== null)) {
    const db = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
    try {
      const insert = db.prepare(
        'INSERT OR IGNORE INTO tracking_lines (kind, seq, line_sha256, payload) VALUES (?, ?, ?, ?)',
      )
      db.transaction(() => {
        for (const target of journal.appends) {
          if (target.kind === null) {
            continue
          }
          const payload = Buffer.from(target.payloadBase64, 'base64').toString('utf8')
          jsonlLines(payload).forEach((line, offset) => {
            insert.run(target.kind, target.baseSeq + offset, sha256Hex(line), line)
          })
        }
      })()
    } finally {
      db.close()
    }
  }

  // 步骤 3：刷新 HashManifest 基线清单
  const staleManifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')) as HashManifest
  const touchedRelPaths = [
    journal.proseRelPath,
    ...journal.appends.filter((target) => target.kind !== null).map((target) => target.relPath),
  ]
  writeManifest(root, refreshManifestEntries(staleManifest, root, touchedRelPaths))

  // 步骤 4：全流程圆满闭合，销毁预写日志
  // 必须所有文件与投影 100% 确认后，才能删除 journal 文件！
  unlinkSync(journalPath(root))
}
```

### 4.3 完备后滚实现规范 (`recoverBackward`)
```ts
function recoverBackward(root: string, journal: PendingCommitJournal): void {
  // 步骤 1：将所有追加流裁剪回初始 baseBytes
  for (const target of journal.appends) {
    const filePath = join(root, target.relPath)
    const disk = readFileSync(filePath)
    const classified = classifyAppendDiskState(disk, target)

    if (classified.state !== 'untouched') {
      // 只要不是未动（即不管是 partial 还是 done），一律截断回基线偏移
      truncateSync(filePath, target.baseBytes)
    }
  }

  // 步骤 2：清扫可能残留的正文临时文件（翻转前的写临时文件）
  rmSync(`${join(root, journal.proseRelPath)}.mozhou-tmp`, { force: true })

  // 步骤 3：删除预写日志，回到干净的 draft 状态
  unlinkSync(journalPath(root))
}
```

---

## 五、 极端异常场景推演与证明

| 异常时机点 | 盘面物理状态 | 恢复流程执行路径 | 最终状态裁决 |
|---|---|---|:---:|
| **场景 A：首次提交在 prose-flip 前崩溃** | 正文为 `draft`，追踪流与事件流部分已追加或全追加 | 命中 `proseSha === journal.originalProseSha256`，进入 `recoverBackward`，全量截断回 `baseBytes`，清理 tmp，删除 journal | **100% 回滚至未提交草稿态** |
| **场景 B：首次提交在 prose-flip 后崩溃** | 正文已翻转为 `committed`，部分流已追加，SQLite 未写 | 命中 `proseSha === journal.stagedProseSha256`，进入 `recoverForward`，补齐未追加流，插入 SQLite，更新基线，删除 journal | **100% 前滚收敛至定稿态** |
| **场景 C：首次在 recoverForward 截断后立即被强杀** | 正文为 `committed`，某流大小等于 `baseBytes`（`untouched`） | 二次启动命中 `recoverForward`。识别为 `untouched`，**执行全量载荷追加**，推进至 `done`，删除 journal | **消除旧缺陷，增量 100% 保全** |
| **场景 D：在 recoverForward 追加后、写 SQLite 前被强杀** | 正文为 `committed`，流大小为 `baseBytes + payload`（`done`） | 二次启动命中 `recoverForward`。识别为 `done`，幂等跳过文件写；重新执行 SQLite `INSERT OR IGNORE`，更新基线，删除 journal | **100% 幂等恢复** |
| **场景 E：在 recoverForward 删除 journal 瞬间被强杀** | 所有正典与 SQLite 已就绪，journal 仍在盘 | 二次启动再次执行 `recoverForward`。所有流均为 `done`，SQLite 均为 ignore，基线重新刷新，成功删除 journal | **100% 确定性自愈** |

---

## 六、 实施与回归验证约束 (Implementation & Gate)

在下一轮工程实施中，修改该模块必须受以下自动化门禁约束：

1. **测试用例扩展要求**：
   - 必须在 `packages/data-plane/src/chapter.recover.test.ts` 中新增单元测试：`recoverForward：支持在 truncate 之后二次崩溃的确定性恢复重入`；
   - 模拟在 `target.baseBytes` 盘面下直接触发 `recoverPendingCommit`，断言恢复后正典文件内容包含全部增量行，且 `verifyBaseline()` 干净。
2. **禁止回归项**：
   - 严禁降低 `classifyAppendDiskState` 的防篡改检查（任何外部脏字节混入必须继续抛 `PendingCommitConflictError`）；
   - 严禁在恢复逻辑中使用硬编码的绝对路径或未统一的常量。
3. **交付标准**：
   - 运行 `probe-07` 重测脚本必须给出绿色通过结果；
   - 彻底闭环消除 `F-01` 致命隐患。

# 回滚说明

本包提供**范围受限**的回滚：只撤销第五轮改的 4 个文件 + 删掉第五轮新增的 3 个测试文件。

## 明确不会做的事

- ❌ 不删 `C:\zcode\novel-ai-handoff-stage4` 整个目录
- ❌ 不动 `C:\zcode\novel-ai\handoff-results\`（原始交回包）
- ❌ 不动 `C:\zcode\novel-ai\handoff-results\review-fix\`（第四轮交回包）
- ❌ 不动 `novel-ai-handoff-stage4\runs\` 与 `.baseline-round5\`（历史运行目录与修前基线）

## 方式 A：一键脚本（推荐）

```powershell
cd C:\zcode\novel-ai\handoff-results\review-fix2\rollback
node rollback.mjs --dry-run    # 先看会发生什么
node rollback.mjs --apply      # 真的回滚
```

想在**副本**上演练而不动真身：

```powershell
$env:MOZHOU_STAGE_DIR = "$env:TEMP\rbfull"
node rollback.mjs --apply
```

脚本做两件事：对 `diffs/*.diff` 执行 `git apply -R`（反向应用），以及删除本轮新增的 3 个测试文件。
每一步都会打印结果**并校验 sha256 是否等于基线**；不一致会计入失败并以非 0 退出。

> **两个必须保留的实现细节**（都已实测，改错了会静默出错）：
> 1. diff 头里的基线路径必须去掉，让两侧都指向活文件。否则 `-R` 会把内容写回 `.baseline-round5/` 并**删掉活文件**。
> 2. 必须带 `-c core.autocrlf=false -c core.eol=lf`。否则 Windows 上回滚出来的文件内容对、**字节不对**（LF 被写成 CRLF）。

## 已验证的回滚结果（在整份 stage 副本上实测）

```
OK    runner.mjs                sha256 与基线一致
OK    harness/accounting.mjs    sha256 与基线一致
OK    harness/transport.mjs     sha256 与基线一致
OK    harness/make-ledger.mjs   sha256 与基线一致
SKIP  offline-budget.test.mjs   与基线逐字节相同，无需回滚
SKIP  child-spend.mjs           同上
SKIP  controlled-upstream.mjs   同上
OK    deleted  audit-red.test.mjs / lock-holder.mjs / init-child.mjs

回滚后：runs/ 仍在、.baseline-round5/ 仍在、原 52 项仍 52/52 通过
```

## 手工反向应用（方式 B）

```powershell
cd C:\zcode\novel-ai-handoff-stage4
git -c core.autocrlf=false -c core.eol=lf apply -R C:\zcode\novel-ai\handoff-results\review-fix2\diffs\harness__accounting.mjs.diff
# 其余 3 个 diff 同理
Remove-Item harness\tests\audit-red.test.mjs, harness\tests\lock-holder.mjs, harness\tests\init-child.mjs
```

## 回滚后自检

```powershell
cd C:\zcode\novel-ai-handoff-stage4
node harness\tests\offline-budget.test.mjs   # 应 52/52
Test-Path harness\tests\audit-red.test.mjs    # 应 False
```

## 只想退一部分

4 个被改文件里，`accounting.mjs`（v2 锁与额度）与 `transport.mjs`（attemptId 事件）是**配套**的，
只退其中一个会让 schema 对不上，回滚后原 52 项大概率不通过。

| 想退的东西 | 操作 |
|---|---|
| 退出新红例，但保留修复 | 只删 3 个新增测试文件 |
| 只退账目报告口径 | 只 reverse-apply `diffs/harness__make-ledger.mjs.diff` |
| 退全部核心修复 | `node rollback.mjs --apply` |

> `runner.mjs` 的 diff 里含「删掉重复帧写入」等接线改动，与 accounting/transport 配套，建议一起退。
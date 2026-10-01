# 回滚方式（ROLLBACK）

## 前提：本轮没有动过任何需要回滚的东西

| 对象 | 状态 |
|---|---|
| 生产代码（`C:\zcode\novel-ai\` 的 9 个目标文件） | **未改**，sha256 逐字节一致（`target-file-hashes-verified.txt`） |
| Git | 未 commit / push / tag / deploy / reset / clean |
| `git status` | 31 条，与 baseline **逐行相同**（`repo-status-after.txt`） |
| 上一版交回包（`handoff-results\` 根目录） | **原样保留**，未删未改 |
| 本轮新增真实调用 | 0 |

## 回滚 = 删除本包

```
Remove-Item -Recurse -Force 'C:\zcode\novel-ai\handoff-results\review-fix'
```

执行后仓库回到本轮开工前的状态。验证：
```
cd C:\zcode\novel-ai\ngit status --porcelain   # 应与 handoff-results\baseline-git-status.txt 相同
```

## 可选：一并清掉测试装置

```
Remove-Item -Recurse -Force 'C:\zcode\novel-ai-handoff-stage4'
```

该目录**完全在仓库之外**，是本轮的测试装置（含旧装置与本轮新增的 harness/、runs/、logs/）。
删掉它不影响仓库、不影响旧交回包。若要保留可审计性，**先**把本包里的 `harness/`、`runs/`、`logs/` 拷走。

## 如果只想回滚某一处

- 想恢复「真实通道默认开启」的旧行为：改 `runner.mjs` 的 `CHANNEL = argOf('channel', 'controlled')` 为 `'real'`。
  **不建议** —— 旧行为正是 Codex 指出的缺陷（真实通道默认可达、无跨进程额度）。
- 想让某次真实运行能发请求：给 `initLedger` 显式设 allowance（如 `--callBudget 2`），
  并加 `--channel real`。两者缺一不可。

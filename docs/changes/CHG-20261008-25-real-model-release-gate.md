# CHG-20261008-25 发布路径真实模型自动化门（议题 #94）

> 触发：GitHub 议题 [#94](https://github.com/xiaohai-uid/mozhou/issues/94)（用户授权，子代理执行、主会话核验落账）。基线 HEAD `9cadfdf`。

## 1. 需求来源

议题 #94：`pnpm test` 默认零真实模型调用；`verify:real-model` 脚本齐备但**没有任何作业跑它**；要求把真实模型路径纳入发布前作业，且**缺凭据必须明确 BLOCKED 并失败**，不得静默跳过。

## 2. 观察基线

| 事实 | 出处 | 结果 |
|---|---|---|
| 默认门零真实模型 | `package.json` `test` = `test:packages` + `test:web` | 无真实模型作业 |
| 发布路径无真实模型步骤 | `.github/workflows/release.yml`（改前） | audit/build/lint/test/typecheck/web test，共 19 步 |
| 既有旅程脚本的默认语义 | `docs/gates.md` + `scripts/verify-real-model-journey.mjs` | 「无密钥 → 写 BLOCKED 证据、**以 0 退出**」——对发布门是「假绿」 |
| 证据字段约定 | `docs/gates.md:49` | `kind, status, sourceCommit, command, exitCode, scope, provider, result, limitations` |

## 3. 实际变更

1. **新增 `scripts/release/real-model-gate.mjs`**（发布路径包装门，退出码 `0 VERIFIED / 1 FAILED / 2 BLOCKED`）：
   - 自己先判定凭据是否在场；缺任一必需凭据 → `status: BLOCKED`、**退出 2**；
   - 有凭据时以 `--strict` 调起既有 `scripts/verify-real-model-journey.mjs`（**未修改该文件**——它正被并行会话改动），使其 BLOCKED 也变成非 0；
   - 落 9 字段结构化证据到 `evidence/real-model-journey/<RUN_ID>/result.json`（该路径被 `.gitignore:43` 忽略，属本地/CI 产物）。
2. **`.github/workflows/release.yml` +22 行**：新增 `Real-model release gate` 步骤（env 由 `secrets` 注入 5 个变量名）+ `if: always()` 的证据上传（`actions/upload-artifact` 固定 SHA `ea165f8…` v4.6.2，`if-no-files-found: warn`，retention 30 天）。**未动 `ci.yml`**（真实模型调用有费用，刻意不进默认 PR 门）。

## 4. 验证（实跑层）

| 检查 | 命令 | 结果 |
|---|---|---|
| 缺凭据必须失败 | `env -u MOZHOU_API_KEY -u DEEPSEEK_API_KEY -u OPENAI_API_KEY node scripts/release/real-model-gate.mjs` | **exit=2**，输出含 `BLOCKED: 未检测到任何真实模型凭据（环境变量名：…）`，并写明「本门不静默跳过」 |
| 证据字段 | `cat evidence/real-model-journey/2026-10-08T15-57-16-565Z/result.json` | 9 字段齐备（`kind/status/sourceCommit/command/exitCode/scope/provider/result/limitations`），`sourceCommit` 为 40 位以内短 SHA `9cadfdf`，`provider.detectedApiKeyVars: []`（只记变量名） |
| 凭据纪律 | `grep -nE "sk-[A-Za-z0-9]{10,}\|api[_-]?key...=[\"'][^\"']{10,}" scripts/release/real-model-gate.mjs` | **零命中**（源码与证据均不含可用凭据字面量） |
| YAML 合法性 | `js-yaml@4.3.2` 解析 `release.yml` | 通过，19 步（子代理实跑） |
| 文档门 | `check:gates` / `check:glossary` | 均 PASS / exit 0 |

## 5. 未做与未验证（如实）

- **VERIFIED 路径未执行**：本机 `MOZHOU_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 均未设置，无可用规范凭据，**未伪造**「有凭据时的成功路径」。
- **GitHub Actions 无法本地验证**：secrets 注入、artifact 上传、hosted runner 的真实结果均未验证（本地无 `act` 运行记录）。
- 证据 JSON 的 `sourceCommit` 字段写的是短 SHA（`9cadfdf`），而 `docs/gates.md` 的推送门约定是 40 位完整 SHA——两处用途不同（本门是发布路径证据，不是推送门收据），但**如需与推送门收据同形，应改为完整 SHA**（未改，留给评审裁决）。

## 6. 回滚

`git revert <本提交>`（删除新脚本并还原 release.yml 的 22 行）。

## 7. 并发说明

`scripts/verify-real-model-journey.mjs` 正被并行会话改动，本变更**未触碰**该文件；本变更用精确暂存只提交自己的文件。

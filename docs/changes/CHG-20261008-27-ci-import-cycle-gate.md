# CHG-20261008-27 CI 依赖环检测（议题 #93）

> 触发：GitHub 议题 [#93](https://github.com/xiaohai-uid/mozhou/issues/93)（用户授权，子代理执行、主会话核验落账）。基线 HEAD `8e8eacb`。

## 1. 需求来源

议题 #93：`grep -rn "graph:check\|gitnexus" .github/workflows/` 零命中，`.gitnexus/` 索引不入库（`git ls-files .gitnexus | wc -l` = 0），因此 **CI 无法跑 `pnpm graph:check`**；2026-10-07 审计发现的 1 个依赖环在 CI 全绿的同时存在于 HEAD。要求：让 CI 能拦住依赖环回归。

## 2. 选型（子代理实测，非猜测）

| 候选 | 实测结果 | 结论 |
|---|---|---|
| `madge --circular` | 仓库根运行解析不了工作区包 `@mozhou/*`——2030 条边里**跨包 0 条**（符号链接只存在于各包自己的 `node_modules`）；传 tsconfig paths 也无效 | **会漏跨包环，不采用** |
| `dependency-cruiser` | 本机代理不可用，连续 3 次下载失败，行为无法验证 | 未验证，不采用 |
| 自带 `typescript` 的 `preProcessFile` | 已在本仓 devDependency；能解 NodeNext `./x.js`→`./x.ts`，也能把 `@mozhou/<name>` 映射回源码；不联网、不读索引 | **采用** |

## 3. 实际变更

1. **新增 `scripts/check-import-cycles.mjs`**（161 行，退出码 0 无环 / 1 有环 / 2 用法错误）：`walk` 扫 `packages`、`apps/web/src`、`apps/web/server`（可传目录参数）；`buildPackageMap` 把 `@mozhou/*` 映射到包 `src/index.ts`；`resolveRelative` 处理 NodeNext 后缀改写；`ts.preProcessFile(text, true, true)` 同时捕获静态 `import`、`require()` 与动态 `import()`；DFS 灰/黑染色找环并按环成员集合去重。
2. **新增 `.github/workflows/graph-gate.yml`**（44 行）：`push` 到 `master`/`main` 与所有 PR 触发，装依赖后 `node scripts/check-import-cycles.mjs`。**未修改 `ci.yml`**（该文件正被并行会话改动）。

## 4. 验证（主会话亲验，非采信子代理自报）

| 检查 | 命令 | 结果 |
|---|---|---|
| 绿（真实仓库） | `node scripts/check-import-cycles.mjs` | `PASS 静态导入环检测：585 个模块 / 1666 条内部边，0 个依赖环。` **exit 0** |
| 红（主会话自造相对导入环） | 在 `C:/zcode/tmp-cycle-sample/` 造 `a.ts ↔ b.ts` 后运行同一脚本 | `FAIL 发现 1 个依赖环：../tmp-cycle-sample/a.ts -> ../tmp-cycle-sample/b.ts` **exit 1**（样例已删除） |
| 红（子代理自造跨包环） | 子代理在临时目录造 `@mozhou/*` 互环 | exit 1，打印 `packages/a/src/index.ts -> packages/b/src/index.ts`（子代理实跑） |
| YAML | `js-yaml` 解析 `graph-gate.yml` | OK：job `import-cycles`，`on` = push[master,main] + pull_request |
| 文档门 | `pnpm run check:gates`、`check:glossary` | 均 exit 0 |
| 旁证 | `node .gitnexus/run.cjs check --cycles --json -r .` | `clean` / `cycleCount: 0`（与静态检测一致） |

## 5. 未做与未验证（如实）

- **GitHub 托管 CI 未真跑**：本地无法执行 Actions（无 `act` 运行记录），新 workflow 的实际行为（runner 上装依赖、脚本退出码）**未验证**。
- **madge / dependency-cruiser 两条路线未验证**：前者实测漏跨包环，后者因网络不可用无法取得。
- **新门未登记进 `docs/gates.md`**：该文件正被并行会话改动，未触碰——登记属后续动作（CI 与文档的「门清单」当前不同步）。
- 脚本的静态解析边界：只覆盖相对导入与工作区包名导入；路径别名（tsconfig `paths`）、动态拼接的 specifier、第三方包内部环不在范围内。

## 6. 回滚

`git revert <本提交>`（删除两个新文件即可，无其它文件依赖它们）。

## 7. 并发说明

本次只新增两个文件，未触碰 `ci.yml`、`packages/`、`apps/web/`、`docs/gates.md`（均为并行会话在制）。

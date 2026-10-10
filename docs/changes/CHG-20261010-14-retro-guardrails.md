# CHG-20261010-14 retro 落地：提交时钩子、推送前门覆盖面与三个新检查

> 触发：用户 `/retro`。核心发现——**本仓的门都在，但没有任何东西在正确的时机跑它们**：CI 只在 `push` 到 master/main 与 `pull_request` 时触发，本地没有任何钩子。而本次会话抓到的三个真问题（重复度门假绿空转、生成物陈旧到 HEAD 过不了自己的 CI、15 处文档陈旧声称）**全属这一类**。基线 HEAD `4ea004d` → `37f77b6`。

## 1. 关键根因（实测，不是推断）

**本机全局 gitconfig 设了 `core.hooksPath = C:/Users/a1691/.zcode/git-hooks`，Git 会完全忽略 `.git/hooks/`。** 我把钩子装在 `.git/hooks/pre-commit` 后做探针提交，**提交顺利落盘**（HEAD 前进、README 逐字节还原）——即那个钩子根本没有执行。这台机器上的仓库级钩子必须放在仓库内并用仓库级 `core.hooksPath` 指向它。

同一发现也修正了 retro 的原始表述：这台机器**不是「没有守卫」**，而是「机器级守卫（凭据字面量扫描、图谱环检查）在跑，但它不跑仓库自己的门」。

## 2. 落地内容（6 项）

| # | 内容 | 位置 |
|---|---|---|
| 1 | **提交时守卫**：钩子先链式调用机器级钩子，再跑术语 / 门清单（含「在 CI」列一致性）/ 包 README / 静态导入环四项秒级检查；生成物新鲜度按索引判定并**阻断**；文档裸数字只告警 | `.githooks/pre-commit`（新，随代码版本化）、`scripts/install-hooks.mjs`（新，激活：设仓库级 `core.hooksPath=.githooks`） |
| 2 | **推送前门补覆盖面**：此前只有 `build`/`lint`/`test`/`graph-check`，而 ci.yml 与 graph-gate.yml 还跑文档门、静态导入环、重复度——这三类**都不在任何本地路径上** | `scripts/ci-gate.mjs` 新增 `doc-gates` / `import-cycles` / `duplication` |
| 3 | **门清单「在 CI」列一致性检查**：双向——点名 workflow 的必须在其中找到该命令；标 ❌ 的不许出现在任何 workflow。此前 `check:gates` 只拿**硬编码的三个门名**比对 ci.yml，于是「克隆检测」那行写着「未接入」而它早已是 CI 作业，门一声不响 | `scripts/check-gates-ci-column.mjs`（新，接入 ci.yml Doc gates + ci-gate + 钩子） |
| 4 | **文档裸数字扫描**（只报不拦）：扫活文档里「旁边既无日期也无命令指针」的规模数字。两轮审计清的 15 处陈旧声称几乎全是这类数字 | `scripts/check-doc-numbers.mjs`（新，接入同上） |
| 5 | **生成物新鲜度按索引判定**：把 `git write-tree` 的树导出到临时目录再跑两个生成器 `--check` | `scripts/check-generated-freshness.mjs`（新，只在钩子里——CI 检出是干净的） |
| 6 | **禁裸 `writeFileSync`**：机械规则且已被证明会重复发生（本次会话靠人工 grep 才找出 11 处）。配两处写明理由的允许清单（锁文件 fd 写入、`{ flag: 'wx' }` 独占创建密钥），并修掉剩下 3 处真裸写 | `eslint.config.js` + `flywheelRoutes.ts` / `providerSettings.ts` / `impact.ts` |

`docs/gates.md` 登记了三个新检查；`AGENTS.md` §8 的推送前门从「只跑 graph-check」改为点名四个任务并加一行钩子说明。

## 3. 为什么第 5 项要按索引（这是本批最重要的一处设计取舍）

上一批我把生成物检查做成**告警**，理由是「工作区可能含他人未提交的改动，阻断会替别人的在制工作背锅」。这个理由对，但代价是**它挡不住「自己的提交把生成物改陈旧」**——`e6d3c31` 给 `impact.ts` 加了一行注释，data-plane 源行数 +1，`docs/architecture.md` 随即陈旧（`15540` → `15541`），而钩子只打印了一行提示就放行了。这是同类漂移在本次会话里的**第 4 次**。

索引语义没有这个问题：`git write-tree` 得到的是**即将提交的内容**，他人未提交的改动不参与。所以它可以是阻断，也应该是。

## 4. 验证（四个负例探针 + 一次守卫自证）

| 探针 | 结果 |
|---|---|
| 钩子是否真的挡提交 | 移走 `packages/kernel/README.md` 后 `git commit --allow-empty` → 被 `verify-package-readmes.mjs` 拦下（exit 1，HEAD 未前进），文件逐字节还原。**对照**：同款钩子装在 `.git/hooks/` 时提交顺利落盘 |
| 「在 CI」列检查是否咬 | 副本里把 duplication 行改回「未接入」→ 报「标为未接入，但 duplication 出现在 graph-gate.yml」（exit 1）；真文件 PASS（14 行核对） |
| ESLint 规则是否咬 | 把 `impact.ts` 临时改回 `writeFileSync` → lint 精确报出该行与规则文案（exit 1）；还原后干净 |
| 生成物新鲜度是否咬 | 把索引里的 `docs/architecture.md` 退回旧版 → 报「与即将提交的内容不一致（索引语义，与他人未提交改动无关）」并给刷新命令（exit 1）；补入刷新版 → PASS |
| **守卫拦下我自己的违规** | 提交第 3 项的修复时，钩子的术语门报 `check-gates-ci-column.mjs:88/89 使用禁用词「门禁」`，**提交被挡下**；改写措辞后通过。这是这道守卫第一次拦下真实违规（且是主会话自己写的） |

干净 HEAD（`37f77b6`）副本上：glossary / gates / readmes / architecture / term-map / gates-ci-column / doc-numbers / generated-freshness **全部 exit 0**（`check-import-cycles` 需要 `typescript` 依赖，干净副本没装 node_modules 跑不了——它在 CI 里先 `pnpm install`，在工作区实测 595 模块 0 环）。

## 5. 未做 / 未验证（如实）

- **未改 CI 触发条件**：ci.yml / graph-gate.yml 仍只在 master/main 的 push 与 PR 上触发，所以往功能分支推送仍拿不到 CI 反馈（本地靠钩子与 `ci-gate.mjs`）。放开到 `feature/**` 会消耗 CI 分钟数，属资源决定，未擅自改。
- **钩子需每个 clone 手动激活一次**（`node scripts/install-hooks.mjs`）——git 钩子的固有代价，未用 husky 之类的依赖换自动安装。
- **`check-doc-numbers.mjs` 阈值未定**，只报不拦；判据（相邻行有日期或命令指针即放行）是启发式，会漏报。
- **ESLint 允许清单有 2 处**：`bookAccess.ts`（锁文件 fd 写入）与 `providerSettings.ts`（`wx` 密钥创建）内**新增**的裸写不会被拦。
- 生成物新鲜度检查每次提交会 `git archive` 整棵树并跑两个生成器（约 1–3 秒）；依赖 `sh` 与 `tar`（Git for Windows 自带），缺任一则 exit 2。
- 机器级钩子的链式调用在每次运行时读 `git config --global core.hooksPath`：全局钩子被改名/移动可自动跟随，被删除则只是不再链式调用。

## 6. 并发说明（精确暂存）

本批 4 个文件被并行会话的术语统一改动覆盖（`scripts/ci-gate.mjs`、`.github/workflows/ci.yml`、`eslint.config.js`、`docs/gates.md`）。均从 `HEAD:` 版本出发、只并入本轮改动（锚点切片 + `git hash-object -w` + `git update-index --cacheinfo`）；`git diff --cached` 新增侧的术语类命中 **0**（删除侧那 2 处是 HEAD 的旧措辞，被我的整块重写替换成规范用词）。

## 7. 回滚

按提交逐个 `git revert`（`e6d3c31`、`358575f`、`37f77b6`）；并 `git config --unset core.hooksPath` 取消钩子激活。

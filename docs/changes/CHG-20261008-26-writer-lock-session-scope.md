# CHG-20261008-26 写锁会话范围声明与证据边界（议题 #100）

> 触发：GitHub 议题 [#100](https://github.com/xiaohai-uid/mozhou/issues/100)。基线 HEAD `dfda2ad`。

## 1. 需求来源

议题 #100（`needs-triage`）：`writerLock.ts` 关于「会话本地命名空间」的陈述不被证据背书；LOCK-01 只按「两个独立 node 进程」实测；要求**确认或修正该陈述**，并给出可复现的跨会话验证方式，或在无法自动化时写清人工验证步骤。

## 2. 观察基线（改前）

| 事实 | 出处 | 结果 |
|---|---|---|
| 陈述混合了两种性质 | `apps/web/server/platform/writerLock.ts:13-16` | 既说「命名管道按登录会话隔离」（Windows 平台语义），又说「跨会话不在支持范围」（设计范围声明）——但读起来像「本仓实测过」 |
| 实测覆盖范围 | `scripts/verify-cross-session-writer-lock.mjs`（LOCK-01） | 三阶段（先占后争 / 释放后恢复 / 同时争抢）连跑 3 次 PASS，但**都是同一登录会话内的两个进程** |
| 计划要求写进发布说明 | `docs/plans/2026-10-03-gitnexus-plan-mozhou-architecture-release.md:188` | 「多 Windows 会话和网络共享目录支持范围**写入发布说明**，未验证网络共享先拒绝为可写书根」 |
| 发布说明实际状态 | `.github/workflows/release.yml` body、安装器 `使用说明.txt` | **均未声明**该支持范围 |

## 3. 实际变更

1. **新增 `docs/spikes/2026-10-08-writer-lock-cross-session-verification.md`**：把陈述拆成「平台语义 / 设计范围声明 / 本仓实测」三栏；说明为什么不能自动化（第二登录会话只能人工构造）；给出可复现的人工步骤与**两种判定及后果**（B 得 `EADDRINUSE` ⇒ 互斥成立，应把理由从「命名空间隔离」改写为「未验证」；B 绑定成功 ⇒ **升级为缺陷**，跨会话写同一书根会绕过写锁）；现状明确记为**未验证**。
2. **`apps/web/server/platform/writerLock.ts:13-22`（注释）**：精确化证据边界——标出哪句是平台语义、哪句是保守声明、本仓实测只覆盖「两个独立进程」，并指向验证程序；同时写明「若实测发现两会话都能绑定同名管道则按缺陷处理」。
3. **`.github/workflows/release.yml` 的 release body**：按计划第 188 行的要求补「支持范围」段（多登录会话不支持 + 跨会话互斥未实测 + 网络共享目录不能作书稿目录 + 指向验证程序）。
4. **`scripts/release/windows/build.mjs` 的 `使用说明.txt`**：安装器随包说明补同一句（多登录会话同时运行不在支持范围；网络共享目录不能作为书稿目录）。

## 4. 验证（实跑层）

| 检查 | 命令 | 结果 |
|---|---|---|
| YAML 解析 | `node -e` 载入 `js-yaml@4.3.2`（`node_modules/.pnpm/...`）解析 `release.yml` | **OK**：job `build-and-verify`、19 步、body 含「支持范围」 |
| 类型 | `pnpm --filter @mozhou/web typecheck` | exit 0 / 0 errors（本次为注释改动） |
| 文档门 | `pnpm run check:gates`、`check:glossary` | 均 exit 0 |
| 图谱 | `node .gitnexus/run.cjs check --cycles --json -r .` | `clean` / `cycleCount: 0` |

## 5. 未做与未验证（如实）

- **跨登录会话互斥未实测**：人工步骤（第 3 节）未执行——本机未构造第二登录会话，且**持有者入口（`--hold` 模式）尚未实现**，是执行该程序的前置工作。故该维度记 **unverified**，不得当作「已验证不支持」。
- **图谱影响分析不可用**：`impact` 对 `apps/web/server/platform/writerLock.ts` 返回 `Target not found`（该文件不在索引内）→ 属**能力缺口已披露**，本次以「注释改动 + typecheck + 文档门 + 图谱环检查」替代核验。
- **GitHub release body 的实际渲染未验证**：本地只解析 YAML，未在 GitHub 上发布过。

## 6. 回滚

`git revert <本提交>`（删除新增 spike 文档，还原注释、release body 与安装器说明）。

## 7. 并发说明

本次改动文件均属本变更（`writerLock.ts`、`release.yml`、`build.mjs`、新增 spike 文档）；工作区其余未提交改动属并行会话，未触碰。

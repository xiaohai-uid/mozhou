# CHG-20261010-05 第四轮复核发现收口 + 依赖漏洞结论取得（R5 结案）

> 触发：第四轮独立对抗复核（**首次判 `release`**，无数据丢失级或安全绕过级阻断）报出的 1 项中等问题、3 项低问题，以及主会话随后自做的全仓同类缺陷清扫。基线 HEAD `6502582` 前后。

## 1. 第四轮判定与它复核的对象

第四轮复核员（非本轮修复者）判定 **`release`**，逐项确认前几批修复**成立**：

| 复核对象 | 结论 | 它的实测依据 |
|---|---|---|
| `abd99f5` 共享 SSRF 判定 | 成立 | 两个调用点策略（协议白名单、超时、`redirect:'manual'`、逐跳复检）逐条保留；`isIP` 门控在 `openaiStream.ts:86/108/123` 三处都在；畸形 IPv6（`:::`、9 段、段值越界）全部 fail-closed |
| `890e295` draft-step 原子写 | 成立 | 读路径缺失→`null`（首次运行正常）；撕裂→抛；调用方 `pipelineRoutes.ts:718` 有 try/catch → 降为章级错误帧 |
| `7a9705d` 409 语义 | 成立 | 409 经 `router.ts:90` 映射；前端 `ProviderSettingsForm.tsx:51` 读 `data.error` |
| `05a70b1` 主密钥备份迁移 | 成立 | 备份名固定 `.bak`、不会被当凭据读回；只在成功读取之后才迁移；从不删除原文件 |

它自己跑的门全绿：lint / build / test（1052+1260）/ duplication 15.88% / 静态环 0 / graph clean / glossary·gates·readmes。

## 2. 第四轮报出的问题与处置

| 级别 | 问题 | 处置 |
|---|---|---|
| 中 | `compile-step.ts:174` `persistPendingDependencyManifest` 裸 `writeFileSync`；`commit-orchestration.ts:293` 回读撕裂 JSON 直接抛 → 提交路径无自愈 | `8d82eed`：改原子写；回读改抛 `PendingDependencyManifestUnreadableError extends SyntaxError`，消息含路径与「删该文件或重编译本章」恢复指引 |
| 低 | `user-edit-step.ts:720` 裸写 `failure-memory.jsonl` | `8d82eed`：改原子写（读侧只逐行容忍撕裂，整份截断会丢尾部记忆） |
| 低 | `proposal-step.ts:172` / `proposal-port.ts:154` 固定 `.tmp` + rename | `8d82eed`：改共享原子写 |
| 低 | `ssrfGuard.ts` `isPrivateOrReservedIpv4` 把 `192.0/16`、`198.51/16`、`203.0/16` 整段拒（注释写 `/24`）→ 误拒真实公网地址 | `7ca8dd7`：收紧到文档段逐段对齐 |

**为什么不自愈（`compile-step` 读路径）**：manifest 的 revision 面取自**编译时快照**，提交时点已无该快照、Receipt 也不载 revision，无法从正典重算出「编译时真正读到的版本」；静默丢弃会让影响分析静默失明。故保留抛错语义，只把文案换成可操作。代价如实写：一次崩溃后该章仍需人工删清单或重编译才能提交（**正文不丢**）。

**第四轮把 `memoStore.ts` 的路径记错了**：实为 `apps/web/server/memo/memoStore.ts:103`（不在 `packages/pipeline` 内），本批未含，另行处置。

## 3. 提交划分

| 提交 | 内容 |
|---|---|
| `7ca8dd7` | fix(security)：收紧 SSRF 保留段掩码，消除对公网地址的过度拦截 |
| `8d82eed` | fix(pipeline)：依赖钉版与提案落盘改原子写，撕裂回读给可操作错误 |

## 4. R5 依赖漏洞结论：已取得（此前挂账「本机无 audit 端点」）

绕开办法是给 `pnpm audit` 指定 registry：

```
pnpm audit --registry=https://registry.npmjs.org --audit-level high   # exit 0
```

| 等级 | 数量 | 命中路径 |
|---|---|---|
| critical / high | **0** | act 容器当初报的 1 high + 2 critical（`tinypool@1.1.1` ×2 经 vitest、`source-map-js@1.2.1` 经 vite→postcss）已消失——独立印证 CHG-17 依赖升级的声称结果 |
| moderate | 4 | `fast-uri`（经 ajv）、`brace-expansion` ×2（经 eslint / typescript-eslint，纯开发链）、`sprintf-js`（经 fastembed→onnxruntime-node→global-agent→roarr） |

**边界**：CI 与 release 门是 `pnpm audit --audit-level high`，0 high/critical 下通过。因此 R5 从「未取得结论」变为**已取得且有数字**；但这**不等于「无漏洞」**，也不等于已修那 4 个 moderate。

## 5. 主会话独立清扫（第五批）：比第四轮更宽的同类扫描

不依赖任何子代理转述，主会话自己对全仓做「裸 `writeFileSync`」扫描（`packages/`、`apps/web/server/`、`src/`、`scripts/`，排除测试与构建脚本），逐处读上下文判定：

| 级别 | 新发现 | 后果 |
|---|---|---|
| 中 | `apps/web/server/routes/backupRoutes.ts:37` 备份 zip 裸写；对外 `sha256` 取自**内存 buffer** 而非磁盘文件 | 写入被截断时盘上是半份 zip，却以「带 sha256 的备份」身份被列出/下载，而 sha 对不上文件 |
| 中 | `packages/data-plane/src/book-backup.ts:228` restore 循环每文件裸写，注释却写「原子落盘」 | catch 会清理，但**进程崩溃**不走 catch，留半份目录无人清理；注释与事实不符 |
| 中低 | `packages/flywheel/src/storage.ts:49` `rewriteObservations` 整表重写裸写；注释称「读侧撕裂容忍使中断安全」 | 逐行容忍只兜行级撕裂，整份截断会丢尾部观测 |
| 低 | `apps/web/server/memo/memoStore.ts:103`、`packages/context-compiler/src/receipt-file.ts:184`、`packages/flywheel/src/semantic/report-store.ts:34` 固定 `.tmp` + rename | 并发写者可互截同一临时文件（`existsSync` 预检是 TOCTOU） |

**经核实不是缺陷**：`apps/web/server/bookAccess.ts:154` 是对已打开锁文件 fd 的写入（配 `ftruncateSync`），不是路径写；锁记录损坏由读侧「判 null 后接管」兜住。

上列 5 类已派子代理收口，结果待落账后补记于本文件与看板。

## 6. 本轮实跑证据（主会话亲验）

| 检查 | 结果 |
|---|---|
| 直调 `isPrivateOrReservedIpv4` | 15 拒 / 10 放行**全部正确**（含 `198.20.0.1` 不被多拦） |
| `pnpm --filter @mozhou/web exec vitest run server/crawlers server/llm server/ssrfGuard` | exit 0，**197 例**通过（ssrfGuard 61、爬虫 80） |
| `pnpm exec vitest run packages/pipeline/src` | exit 0，32 文件 / **260 例**通过（+4 例） |
| `pnpm --filter @mozhou/pipeline exec tsc -p . --noEmit` | exit 0 |
| 原子写临时名核验 | `ATOMIC_TMP_SUFFIX='.mozhou-tmp'`，实际名 `<target>.mozhou-tmp-<pid>-<seq>-<rand>` → 「无残留」断言非恒真空转 |
| `pnpm audit --registry=https://registry.npmjs.org` | 0 info / 0 low / **4 moderate** / 0 high / 0 critical |

## 7. 并发说明（精确暂存）

`user-edit-step.ts` 与 `user-edit-step.test.ts` 的工作区副本混有停摆工作线未提交的术语改动（`守卫`→`门`、`数据平面`→`数据面`）。提交时从 `HEAD:` 版本出发、只套用本轮自己的 3+2 处改动，经 `git hash-object -w` + `git update-index --cacheinfo` 入索引；核验结果：`git diff --cached` 中他人术语改动行数 **0**，未暂存的术语行数 **10 + 2**（对方改动原样留在工作区）。其余 6 个文件已逐个 grep 确认无夹带。

## 8. 仍未修 / 未验证（如实）

- **第五批 5 类**（备份 zip、restore 注释、flywheel 整表重写、三处固定 `.tmp`）收口结果待落账。
- **并发写者互截**只在单进程内由原语（`wx` + 唯一名）保证；未做多进程/掉电实测。
- **4 个 moderate 依赖漏洞未修**（仅登记路径与等级）。
- **提交路径不自愈**是有意选择，代价见 §2。
- 沿用：安装器签名、未推送（未跑 act 本地 CI 门）、Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）、真实微信/支付宝联调、`naming` 502 真实模型路径、`check:term-map`/`check:architecture` 因并行会话未提交改动 STALE。

## 9. 回滚

`git revert 7ca8dd7 8d82eed`；`user-edit-step.ts` 回滚需保留停摆工作线的术语改动（勿整文件 checkout）。

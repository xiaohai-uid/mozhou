# CHG-20261012-01 — 作者边界与发行验收收口

- 日期：2026-10-12；执行：Codex（AI 辅助）。
- 用户请求：独立核对最新架构与代码；仅在检查通过后提交、合并并上传安装包。
- 基线：feature/windows-local-release，HEAD 8907eac01c267e96a60025f2bf0e35a98580ef9c，已有15份受跟踪修改及本轮新增文件。原工作区保留，不重置或清理。
- 依据：specs/005-author-data-boundary-hardening/；此前独立验收及本轮真实隔离复现。
- 已复核：上一轮S1–S4及T1–T3均通过当前定点回测；不沿用旧失败。
- 新增复现缺陷：压缩流取消不能结束；DNS等待不受中止与时限约束；旧候选覆盖同章的新运行态。现已修复并通过定点回测，完整检查与真包验收继续进行。
- 定点范围：packages/pipeline/src/draft-step.ts与对应测试；apps/web/server/net、llm、crawlers、search的请求生命周期与对应测试。
- 恢复材料：本次编辑前已保存所涉及源文件与SHA-256清单至当前任务的work/release_before/；其他作者改动不纳入恢复。
- 验收：取消须结束待决操作；压缩与未压缩响应均保留正确错误分类；新任务运行态不被旧任务修改；真实包入口使用独占新建数据根。
- 图谱：已按当前CLI调用impact，指定符号未找到，尚未宣称完成调用图门禁；须用源码核对d=1/d=2调用并在收尾执行变化检测和环检查。
- 发行条件：现有安装包来源旧提交且未签名；真实安装/升级/卸载必须使用已证明隔离的Windows环境。源码检查、合成服务或产物哈希不能替代这些条件。
- 状态：代码修复与完整源码检查已通过（含下节回归修复）；新包启动对照仍在验证，发行条件未满足。尚未提交、合并或上传。
- 回滚：逐项核对后续作者修改，从保留的范围副本恢复仅本次编辑；不得清理其他工作。

## 实际调用影响与接线

- draft-step状态写入：d1为生成绑定内的开始、取消、失败和完成；d2为唯一生产pipelineRoutes/runDraftStep的结果与流终帧。旧任务不能通过当前章指针借用另一候选结果。
- 出站传输：d1为LLM生成/测试连接、爬虫与检索；d2为草稿、命名、分镜、提取/审查以及榜单和检索路由。
- CLI无file过滤可识别runDraftStep，但报0个调用方，与源码中pipelineRoutes.ts唯一生产调用不符；因此调用图覆盖不足，使用源码补充，未冒称完整图谱影响门通过。
- 路由把本次candidateId传给runDraftStep，供本次任务结果回读；可选字段保持离线旧调用兼容。
- WinClaw知识对账：检索“墨舟 Windows 安装 签名 取消 运行态”，命中旧项目状态失效说明及流程条款，没有命中这三处当前缺陷的专门记录；当前行为以源码与隔离实测为准。

## 运行态模型审查

- 术语：候选运行态表示本次生成产出与原因；章运行态表示当前认领者，二者不与正文、事件账本或采纳意图混用。
- 场景：旧A取消、完成、失败或备用attempt晚到，新B状态保持不变；初次等锁已取消的A不能认领；续写基底不算本次产出。
- 代码契约：私有文件先写，章文件在书锁内按candidateId核对归属；唯一生产runDraftStep入口传入candidateId；路径复用既有UUID校验。
- 持久边界：保持stateVersion1、旧章文件向后兼容，不迁移或删数据。新增派生文件不是两文件事务；真实进程中断恢复仍未验证，回退代码时保留数据。

## 定点修复与验证

- 草稿归属：原draft-step、锁取消和新增ownership三文件，34条通过；新增结构Snapshot通过。生产路由接线由独立复核者核对。
- 出站：四文件38条通过；压缩取消/远端断流/消费者提前结束、DNS与正文时限、跨origin凭据移除、同origin保留、TLS原域名与错误证书拒绝均有隔离样本。
- 全局Agent环境代理会绕过连接绑定，因此请求使用agent:false独立直连；依赖环境代理的真实提供商连通性仍未验证。
- DNS取消结束调用方等待，晚到解析不建连；不宣称OS DNS查询本身已取消。

## 独立执行的完整检查（2026-10-12）

- 根工作区构建、Web生产构建、Web类型检查和全仓lint均退出0。
- 包层：122文件/1089条通过；生命周期bench另3条通过。Web：159文件/1335条通过，1文件/15条跳过。跳过不算通过；这些结果不证明真实模型或安装升级验收。
- 文档门初次报告architecture生成物陈旧；使用既有生成器更新后全套文档门退出0。静态导入环604模块/1734条内部边、0环；重复度门退出0。
- GitNexus已刷新索引并执行detect-changes与check；后者clean/cycleCount0。按文件impact仍Target not found，无file汇总缺少可靠符号身份；影响判断使用源码d1/d2，未宣称完整图谱影响分析通过。detect-changes仅覆盖受跟踪差异，新增文件另行读源与实测。
- Windows Node24.18.0独立探针再次核对压缩取消、DNS等待、跨origin凭据过滤与HTTP500清理；真实回环HTTPS保留原Host/SNI、错误域名拒绝。TLS合成证书只在本次子进程信任，未改机器证书。
- 新Windows候选128703335字节，SHA256 a2bb06b505f0a6f5d019ff34e95b1547d2d14a3e191b85e13dbe80c95707ce6e；来源8907eac01c267e96a60025f2bf0e35a98580ef9c-dirty。旧包与旧回执已保留；新包仍NotSigned。
- 真实模型发布入口实际退出2/BLOCKED/NO_REAL_MODEL_CREDENTIAL，未执行付费请求；环境变量检查仅记录在场变量名，不回显取值。
- 真包最初在仓库构建位置启动失败，独占Documents和Temp数据目录均复现desktop.log UnauthorizedAccessException；不把该失败隐藏成通过。诊断对照在本机受信目录同源码可写日志，尚须用同包字节确认实际运行路径。未关闭系统防护、未改ACL/区域配置或去除安全标记。

## 收口复核（2026-10-12 续，ZCode 执行）

- 复核发现上一节「完整源码检查已通过」早于偏好面板崩溃修复，未覆盖该修复；该修复把 `../../shared/api.js` 静态引入服务端，触发 `TS6059`（`apps/web/server/routes/flywheelRoutes.ts:26`），`pnpm --filter @mozhou/web typecheck` 实际退出 2。原结论对该修复不成立。
- 根因：`apps/web/tsconfig.server.json` 有独立 `rootDir: "server"`（`boundaryHardening.test.ts:20` 注释说明服务端须动态加载 shared 以避开它），服务端静态 import `shared/` 会把 shared 拉进服务端编译程序。
- 修复：响应 DTO（`PreferenceDimensionData` / `PreferenceProfileData`）就地声明在 `flywheelRoutes.ts`，与 `shared/api.ts` 同口径并注明「改动必须同步」——沿用 `memoRoutes.ts` / `server/api.ts` 各自声明同名 DTO 的既有先例。未改 tsconfig、未新增依赖、未放宽任何门；客户端契约与投影逻辑不变。
- 复核后实测（同一工作区）：`tsc -b` 退出 0；`pnpm --filter @mozhou/web typecheck` 退出 0；`pnpm lint` 退出 0；`test:packages` 122 文件 / 1089 用例通过（bench 另 1 文件 / 3 用例）；`test:web` 160 文件 / 1338 用例通过、1 文件 / 15 用例跳过；`doc-gates` / `graph-check`（clean, cycleCount 0）/ `import-cycles`（605 模块 / 0 环）/ `duplication` 均退出 0。
- `docs/architecture.md` 复核时为 `STALE`，用既有生成器 `node scripts/gen-architecture.mjs` 重建后 doc-gates 通过（web 177→178 文件，即新增契约测试）。
- 图谱 `detect_changes`：38 个改动符号 / 19 个文件，`risk_level: critical` 由热点常量 `INTENT_SCHEMA_VERSION`（`draft-accept.ts`）的过近似传播放大，非新增缺陷；按文件 `impact` 仍 Target not found，影响判断继续以源码 d1/d2 为准，未宣称图谱影响门通过。
- 观察（非阻断）：`PreferenceProfilePanel` 相关测试打印 React `act(...)` 告警，用例仍通过；属测试时序告警，未改断言。
- 发行缺口不变：签名（NotSigned）、独立 Windows 安装/升级/卸载验收、真实模型发布门（BLOCKED/NO_REAL_MODEL_CREDENTIAL）均未满足；本轮未提交、未合并、未推送、未上传。

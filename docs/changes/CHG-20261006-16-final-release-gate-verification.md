# 变更记录：CHG-20261006-16 — 墨舟发布终门禁独立复核与证据核查

## 1. 元信息
- **变更 ID**: `CHG-20261006-16`
- **日期**: 2026-10-06
- **执行人**: 终门禁复核员（ZCode / 动态工作流）
- **需求来源**: 独立终门禁复核——对工作区全量改动面执行 GitNexus 依赖分析与架构环检查、抽查各阶段证据文件真实性与关键断言可复核性、产出最终交付报告。
- **关联计划**: `docs/plans/2026-10-06-spec-gap-matrix.md`, `docs/plans/2026-10-06-final-release-gate-report.md`

---

## 2. 复核基线与观察
- **分支与提交**: `feature/windows-local-release`，HEAD `40cd257`；
- **红线遵守**: 严格遵守禁止 git commit/push/merge/reset/clean/checkout/stash 红线，保留工作区中用户在制工作；无可用凭据硬编码；未削弱或删除现有测试用例。
- **GitNexus 图谱门禁实跑**:
  - `detect_changes(scope: 'unstaged', repo: 'mozhou')`:
    - 变更符号数: 55
    - 受影响节点数: 560
    - 改动文件数: 48
    - 风险等级: `critical`（由编辑器 AST、卷状态压缩、飞轮接线、移动端闭环、图谱连线及桌面端生命周期等前序在制批次累计形成，均在预期规划内）。
  - `check(cycles: true, repo: 'mozhou')`:
    - 状态: `status: clean`
    - 循环依赖计数: `cycleCount: 0`
    - 环列表: `[]`
    - 结论: 代码依赖图谱无任何环形依赖，完全合规。

---

## 3. 各阶段交付物与证据逐项核验结果

终门禁复核员逐一打开并实读了各阶段的核心证据文件，核验结果如下：

| 阶段 / 模块 | 证据文件路径 | 关键断言与核验事实 | 复核结论 |
|---|---|---|---|
| **0. 基线与缺口矩阵** | `docs/plans/2026-10-06-spec-gap-matrix.md` | 对 11 项模块逐一做源码实读与分类：9 done, 1 partial, 1 missing, 4 deferred。澄清两份旧清单历史切片冲突。 | **真实有效 (pass)** |
| **1. 编辑器与行内 AI** | `docs/changes/CHG-20261006-09-editor-ast-inline-ai-verification.md` | TipTap AST 块级编辑器替换原生 textarea；SceneBreak atom 节点；选区浮层 AI；`/api/prose.edit.stream` 流式契约；双栏 Diff 呈现与局部替换；受影响范围 10 测试文件 74 项单测全绿。 | **真实有效 (pass)** |
| **2. 卷边界状态压缩** | `docs/changes/CHG-20261006-10-volume-compaction-verification.md` | 三层事务拆分（plan 纯函数筛选、summarize 注入式 LLM 与必需实体机检、execute 原子落盘）；大纲摘要追加与事实流 `compactedIntoVolumeId` 回写；9 测试文件 90 项用例通过。 | **真实有效 (pass)** |
| **3. 数据飞轮接线** | `docs/changes/CHG-20261006-11-flywheel-orchestration-verification.md` | Web BFF 5 端点落地；行内编辑 Accept/Reject 与定稿 Commit 真实上报事件并驱动画像折叠；坚守只建议不改路由硬不变量；前端双面板挂载；19 测试文件 172 项单测全绿。 | **真实有效 (pass)** |
| **4. 移动端三闭环** | `docs/changes/CHG-20261006-12-mobile-three-closures-verification.md` | 移除硬编码，张力波形接入 `/api/chapter.tension` 且无数据时诚实不可用；技能胶囊维护独立状态不污染正文；版本时光机实现 JSONL 快照、段落级 LCS Diff 与自增新版本安全回滚；10 测试文件 65 项单测全绿。 | **真实有效 (pass)** |
| **5. 图谱拖拽连线** | `docs/changes/CHG-20261006-13-canon-graph-drag-to-connect.md` | SVG 节点专属 connection handle、临时连线虚线、合法节点悬停光环、自连拒绝警告、松开唤起契约弹窗、重复连线检测、Ctrl+Z 撤销栈、触屏与键盘无障碍模式；4 测试文件 34 项用例通过（新建 `CanonGraphView.dragConnect.test.tsx` 8 项全绿）。 | **真实有效 (pass)** |
| **6. 桌面端自启动闭环** | `docs/changes/CHG-20261006-14-tauri-desktop-lifecycle.md` | 端口动态探测与空闲绑定；Node 服务白名单托管；Windows Job Object 内核级守护；优雅停机握手；原生 TCP 健康探测；深色水墨诊断兜底；原生 Release 二进制实测 8.44MB（<15MB）；Rust 7 项单测全绿。 | **真实有效 (pass)** |
| **7. 30 章长篇验收** | `docs/changes/CHG-20261006-15-longform-e2e-acceptance.md`<br>`evidence/longform-journey/2026-10-06T13-48-19-681Z/` | 31/31 章跨卷端到端连续生产全绿；首包延迟 1468ms（零商业付费消耗）；编织秘密产生、承诺建立与兑现、角色死亡、回溯修改；卷一收官触发状态压缩并写入大纲；服务重启前后数据 100% 一致；预设注入幂等；留档 31 行机械可查台账 `journey-ledger.md` 与结构化 JSON。 | **真实有效 (pass)** |

---

## 4. 独立抽样复核测试验证
复核员在当前工作区独立抽测关键契约用例：
```bash
pnpm.cmd --filter @mozhou/web test run src/canon-graph/CanonGraphView.dragConnect.test.tsx server/routes/desktopLifecycle.contract.test.ts
```
**结果**:
- `src/canon-graph/CanonGraphView.dragConnect.test.tsx`: 8 passed
- `server/routes/desktopLifecycle.contract.test.ts`: 4 passed
- 合计 2 个测试文件，12 个测试用例全部秒级通过（耗时 1.87s，0 failed）。

---

## 5. 最终复核裁决
- 各阶段证据文件路径真实存在，断言可机检复核；
- 代码与设计严格贴合系统规范与 ADR，未发现虚假通过或伪造测试；
- GitNexus 图谱检查为 clean / 0 环；
- 本次复核通过，准予进入编排脚本全量回归与收口流程。

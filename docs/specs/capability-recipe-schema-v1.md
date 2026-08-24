---
date: 2026-08-24
description: '工单 #33 产出：Capability Recipe Schema v1 冻结——类型化字段+JSON Schema 校验，静态四型触发表，降级矩阵与 trackingGate 七件套入 Schema，双轨版本+零兼容承诺，MIT 出处字段化'
tags:
  - project-note
  - mozhou
---

# Capability Recipe Schema v1（工单 #33 产出）

> 相关笔记：[[runtime-capability-spec]] · [[t30-c-recipe-anatomy]] · [[t30-d-upstream-convergence]] · [[kernel-schema-draft]] · [[2026-08-24-wayfinder-phase-3-map]]
> 工单 [#33](https://github.com/xiaohai-uid/mozhou/issues/33) · 前置：[#31 执行基底收口](https://github.com/xiaohai-uid/mozhou/issues/31)（已关）· 出题材料 [t30-c-recipe-anatomy.md](./t30-c-recipe-anatomy.md) §5（F1-F17）
> 边界：本票裁 Recipe Schema 本体；Capability↔Skill 运行时注册协议归 #31 规格；十步编排归 #32
> 决策过程：grilling 三批共九问（R1-R9），全部由作者拍板（按「按推荐来」采推荐选项）

## 0. 一句话

**CapabilityRecipe = 方法论配方的机器可校验冻结单元：类型化字段 + JSON Schema 校验、静态四型触发表、failure 矩阵与 trackingGate 七件套全部入 Schema；一配方可实例化为 N 个 SkillRun。**

## 1. Schema 正文（YAML 注释版）

```yaml
schemaVersion: 1                        # 本 Schema 自身版本；不兼容即拒（R7 双轨之上游）
recipe:
  id: string-kebab-case                 # F1 ★★★ 全局唯一
  recipeVersion: 1.0.0                  # F2 ★★★ 每配方独立 semver（R7 双轨之下游）
  source:                               # F3+R9=A MIT 出处字段化（机器可查）
    repo: worldwonderer/oh-story-claudecode   # 或 "original"（自研配方）
    commit: 9d0bd5f5aead707ddcf7d5f141b237e2ac464c  # 全 SHA 落库，短 SHA 仅展示
    license: MIT | original
    refinedAt: 2026-08-24              # 炼化转写时间
    refineNote: string                 # 转写说明（改了什么/为何）
  brief:
    capability: string                 # F4 拆分·能力句
    runtimeSemantics: string           # F4 拆分·运行与降级语义人读版
    triggers: string[]                 # F4 拆分·触发词枚举
  taskType: TaskType                   # F5 · 对齐 #31 CapabilityType 词表
  entry:
    routerDoc: path                    # F6 入口指令文档
    phases: string[]                   # F6 阶段停靠点（防失控）
    stopPoints: string[]
  references:
    - path: path
      loadCondition:                   # F7+R3=A 静态声明式四型，runtime 解释执行
        type: phase | input | fallback | always
        value: string                  # 阶段名 / 输入键 / 兜底索引查询式
      failure:                         # R4=A 降级矩阵条目化（C 路 F9）
        policy: repair | skip | failFast | rebuildFromRevision
        repairAction: string?          # policy=repair/failFast 时的修复指引
  artifacts:
    - path: path
      granularity: string
      createdPhase: string
      readTiming: string
      sizeBudget: { target: number, max: number }     # F8
      failure: { policy: …, repairAction: …? }        # 同 references 条目（R4=A）
  prechecks:
    - script: path                     # F11 确定性预检：只报告不改写
      severityPolicy: blocking | advisory
      retryPolicy: { maxBlockingRetries: 2 }
  trackingGate:                        # F12+R5=A 整槽七件套（tracking_commit.py 同构）
    authorityState: path               # 权威态文件
    casField: string                   # 乐观并发字段（expected_state_revision 同款）
    transactionModes: string[]         # 提交事务模式枚举
    derivedViews: [{ name, path }]     # 派生视图（可重建）
    budgets: { hotContextBytes: number, perChapterReads: string[] }
    failureTaxonomy: validationFailed | writeFailed | drift   # 失败三分法
    hookPoint: preWrite | postWrite | none             # 写入路径强制钩子位
  contextBudget:                       # F16+R6=A 容量预算入 Schema
    hotContextBytes: number            # 上游实证 7 栏 ≤12288B
    fixedSections: string[]
    perChapterReads: string[]
versioning:
  schemaVersionRule: incompatible-change-requires-major-reject   # R7=A 不兼容即拒
  retiredPaths: [path]                 # R7=A 显式退役声明（RETIRED 先例），init 时归档
compatibilityPolicy: none              # R8=A 旧结构不解析；breaking 必升 major 附迁移入口
```

## 2. 裁决理由表（九问全录）

| Q# | 议题 | 裁决 | 理由 |
|---|---|---|---|
| R1 | 命名去留 | A 保留 CapabilityRecipe | 配方≠SkillDefinition（运行时注册实体）；「一配方→N SkillRun」映射；改名成本高 |
| R2 | 结构化程度 | A 类型化字段+JSON Schema 校验 | 机器可校验正是墨舟相对上游的价值位 |
| R3 | 触发表 | A 静态声明式四型枚举 | 上游实证四型够用，DSL 过度设计 |
| R4 | 降级归属 | A 进 Schema 条目化 | C 路 F9 六条上游实证+同款可校验精神 |
| R5 | 映射+trackingGate | A 实例消费方映射+七件套整槽 | 七件套=ChapterCommit 同构物，配方自描述追踪义务 |
| R6 | 容量预算 | A contextBudget 入 Schema | 不同配方不同热上下文胃口 |
| R7 | 版本退役 | A 双轨版本+retiredPaths 字段化 | tracking_commit.py 双版本号+RETIRED 先例 |
| R8 | 兼容承诺 | A compatibilityPolicy="none" | C 路 F14 实证+工程原则 1 |
| R9 | 出处字段 | A source 三件套字段化+refineNote | M20 pin 纪律机器可查落点 |

推断项处置：F3 的 commit/license 字段化经 R9 拍板转正；F4 结构化拆分经 R2 转正；F5 taskType 已由 #31 CapabilityType 词表吸收。

## 3. 与应用线的映射纪律

- 一个 CapabilityRecipe 可实例化为 N 个 SkillRun（应用线 SkillRuntime 五内置技能 = 首批实例消费方）
- 命名边界：`recipe`=方法论配方（本 Schema 管辖）；`SkillDefinition/SkillRun`=应用线运行时注册与执行证据实体（其 FROZEN 契约不因本 Schema 变更）
- ContextAssembler 产物的引用方式由实现票对齐，不改本 Schema

## 4. 回填验证要求（完成定义）

五内置技能之一（建议 quality_gate）按本 Schema 实例化试跑：字段全覆盖、加载器 fail-fast 行为符合 R4 矩阵——验证通过方可在 Resolve 评论标记完成。

## 5. 兼容与增补

- compatibilityPolicy="none"：v1 冻结后任何 breaking change 升 schemaVersion major 并附专用迁移入口；禁止静默兼容层
- 新增非 breaking 字段走受控增补（沿 kernel-schema 先例），并在本文档 §2 表追加行

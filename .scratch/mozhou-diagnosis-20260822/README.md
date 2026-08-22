# 墨舟三案只读诊断 — 2026-08-22 会话

## 已确认决定
- 三案并行只读诊断，汇总报告后等用户拍板再动手
- dev 3300 保留运行
- UI 方法论改为「UI 先行」：UI 达到可用 → 再接后端服务；不复刻参考项目

## 案一：技能可选挂载（实现偏离决策）
- 决策锚点 A：2026-08-10 R4 = chat 风格/技能胶囊，单选/多选注入 system（commit cc41ef5）
- 决策锚点 B：2026-08-15 五要点 = 默认技能按阶段自动调用 / 五类默认创作技能 / 扫榜拆解产物回流 / SkillRun 证据 / 自定义 Skill 四要素
- 待查：chat 注入链、payload 组装、技能广场五页 UI 与后端是否脱节

## 案二：正文插入第二条起全 409
- 嫌疑1（最重）：首插成功后客户端未刷新基准 → 过期 expectedContent
- 嫌疑2：候选状态机误拒兄弟候选
- 嫌疑3：messages 列表刷新丢候选状态/ID
- 冲突码现值 ContentChanged（非 DocumentConflict）

## 案三：UI
- 先 git log -p 巡检 components/features/**、全局样式、tailwind 配置，查用户手改是否被提交冲掉（P0 恢复项）
- 巡检后按「UI 先行」出方案

## 修复批次（已拍板 2026-08-22 晚）
- 案二：批准执行（删守卫 + DELTA 加 revision + 连插测试）
- 案一：选项乙（真实开关：章节规划/读者与题材/叙事声音可关，story_grounding/quality_gate 常开）+ workbench 加挂入口
- 案三：UI 先行重做单独立项，本批次不动视图样式

## 基线（已核实）
- /mnt/c/zcode/novel-ai/app @ 37965d5 main 干净；3300 与 one-api 3000 均存活

## 处置结果（2026-08-22 当日闭环）

| 案 | 处置 | 提交 |
|---|------|------|
| 一 技能可选挂载偏离拍板 | 选项乙「真实开关」：基础设施型（story_grounding/quality_gate）始终注入；开关型（章节规划/读者与题材/叙事声音）进胶囊由用户选择，默认全选；workbench 补加挂入口（UI 胶囊行 + payload 携带 skills[]） | `947f12b`（DELTA-004） |
| 二 连续插入 409 | 移除服务端 baseRevision 守卫；insert 响应携带 revision；expectedContent+force 双层保护语义不变 | `62991fa`（DELTA-003） |
| 三 UI 难看 | 按用户拍板转入独立「UI 先行」计划（先可用后接服务），不在本次代码批次内 | — |

验证：unit 349/349；http 全套件绿；CI run 32577296565 两 job success（`95a823d` 测试适配后）。

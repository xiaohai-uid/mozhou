# 墨舟 (MoZhou) V1.1 Release Report

- **版本**: v1.1.0
- **日期**: 2026-08-11
- **分支**: main（70+ 提交，V1.0 后 +21）
- **性质**: V1.1 四个 Journey 全部真实化交付 · 通过人工验收（14/14）

## 交付范围（V1.1 User Journeys）

1. **⑥ 风格库持久化**（工单 14/15）：styles 表 + CRUD（归属校验）+ 蒸馏页命名保存/列表/删除 + 应用到对话回流（styleId 引用）+ chat 风格胶囊真实库 + 服务端四维指南注入
2. **⑦ 章节级续写**（工单 16-19，UI-First 三轮迭代冻结）：
   - 章节编辑器（正文读写 + 防抖自动保存 + 显式保存 + 保存状态）
   - 章节对话引擎（chapter_messages 持久化 + SSE + 注入链：正文参考→RAG→风格→技能 + 对话跨会话留存）
   - 技能驱动对话（内置场景技能 章节续写/章节起笔 + 我的技能组合 + 注入标签）
   - 插入与冲突保护（快照比对 → 409 ContentChanged → force，DocumentConflict 语义，用户内容永不覆盖）
   - 错误人性化（humanizeError 映射契约 21 错误码）+ ⑧ Cancelled 并入（停止→stopped 保留已生成）
3. **④ sync 文件级推送**（工单 20）：WebDAV 单向备份（mozhou/作品/章节.md）+ 手动立即同步 + autoSync 自动
4. **⑤ websearch 引用入文**（工单 21）：结果多选 → 回流写作对话（【引用资料】格式多条合并）

## 质量数据
| 项 | 值 |
|---|---|
| 契约测试 | **139/139**（17 文件；V1.0 109 → +30） |
| Lint | 0 errors / 0 warnings |
| TypeCheck | ✅ |
| Production Build | ✅ |
| Manual Acceptance | ✅ 14/14（V1.1 四个 Journey 核心路径实测） |
| Migrations | 0000-0012（含追踪表；0010-0012 V1.1 新增） |
| 契约 | 23 组端点全部入契约（api-contract.md，V1.0 20 → +3 节） |
| 新端点 | styles CRUD / 章节正文 GET·PATCH / 章节对话 GET·POST(SSE) / insert / sync/push / sync/config PATCH |

## 关键设计（可追溯）
- UI 工作方式：参考灵笔（lingbi-next：DocumentConflict/CandidateStale/humanizeError/autosave）+ 笔枢写作（技能化流程）+ 墨舟既有 skill 体系 → 技能驱动对话
- 测试 seam：HTTP 契约测试（真实 dev server + mock provider 回显 system 使注入可断言）；生成内核复用管线（runNodeStream）
- 决策记录：spec.md V1.1 章节（B1-B11/Q1-Q4/S1-S4/W1-W2）+ CONTEXT.md 术语表

## 排除范围（用户定案，勿劝）
- ① 会员支付真实化（支付二期）② projects 审查记录+导出备份 ③ 书源 HTML 规则解析器（R5 决策边界）

## 下一步候选（待人类指令）
- V1.2：③ 书源 HTML 规则解析器 / 正文编辑 undo / 章节对话跨设备 / 会员额度体系补全

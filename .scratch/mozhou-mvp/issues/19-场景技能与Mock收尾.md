# 19 — 场景技能 + 错误人性化 + Mock 收尾（Progressive Swap 完成）

**What to build:** 内置场景技能注入（章节续写/章节起笔）+ 错误码 → 人性化映射 + mock 函数族清理 + 演示菜单删除，progressive swap 收尾。

**Blocked by:** 17（注入链）

**Status:** ready-for-agent

**契约（21-章节级续写契约.md 第 3 节）：**
- 场景技能 = 平台内置常量（章节续写/章节起笔，按章节空态切换），注入与普通技能同构（`[技能] 名称：systemPrompt`）
- 技能组合 = 内置场景技能 + 我的技能（/api/v1/skills?scope=mine 已装）
- 错误码 humanize 映射（客户端）：AiNoApiKey/AiRateLimited/AiServerError/AiTimeout/AiNetworkError/AiInvalidResponse/AiCancelled/ContentChanged → 标题+怎么办+动作
- 空章节「让 AI 起笔」= 触发「章节起笔」技能（随消息 skills[] 传）

- [ ] 内置场景技能常量（lib/chat/skills.ts 或同层）+ 注入（章节续写：通读前文保持文风；章节起笔：按设定起笔）
- [ ] 契约测试：场景技能注入断言（mock 回显）/ 组合技能（内置+我的）
- [ ] 客户端错误人性化映射（humanizeError，对齐灵笔语义）
- [ ] 章节页 mock 函数族清理（mockSendChat/mockInsert 等移除，纯真实 API 调用）
- [ ] 演示菜单删除（normal/fail/no-model/empty 全部移除）
- [ ] 契约文档 api-contract.md 第 21 节正式并入（Contract Frozen 确认）

**验收：** 无 mock 残留（代码 grep 无 MOCK_ 前缀）；错误人性化面板在 fail 场景可用（真实错误码路径）。

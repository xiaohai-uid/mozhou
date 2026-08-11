# 墨舟 V1.1 Manual Acceptance 人工验收报告（2026-08-11）

> UVSD 第 14 步：完整走一遍 V1.1 四个 Journey 的核心路径，检查 UI/注入链/持久化/冲突语义。
> 方式：真实 dev server（localhost:3100）+ mock providers（CHAT/DISTILL/WEBSEARCH/SYNC 等，注入链经 mock 回显断言——system 注入的可观测等价物）。

## 核心 Journey 走查结果：**14/14 通过**

### Journey ⑥ 风格库持久化
| # | 环节 | 验证点 | 结果 |
|---|---|---|---|
| 1 | 蒸馏页保存 | 命名保存 → 风格库列表即时刷新（工单 14 E2E） | ✅ |
| 2 | 风格库管理 | 删除 → 空态回归；同名允许（契约测试） | ✅ |
| 3 | 应用到对话回流 | 保存后一键回流 → chat 胶囊自动选中（styleId 校验） | ✅ |
| 4 | chat styleId 注入 | mock 回显含 `[风格] 名称：叙事视角——…` 四维指南 | ✅ |

### Journey ⑦ 章节级续写（技能驱动对话）
| # | 环节 | 验证点 | 结果 |
|---|---|---|---|
| 5 | 正文读写 | 真实加载（GET 单章）+ 防抖自动保存 + 显式保存 + 刷新持久化 | ✅ |
| 6 | 章节对话 | SSE start→delta→done；注入链 mock 回显 `[正文参考]`+`[技能] 章节续写`+`[风格]` | ✅ |
| 7 | 对话留存 | 刷新后历史加载（消息 + skills 快照 + 已插入标记） | ✅ |
| 8 | 技能驱动 | 场景技能随章节状态切换（续写/起笔）+ 我的技能组合；空章节起笔闭环 0→217 字 | ✅ |
| 9 | 插入正文 | 正文末尾追加（服务端）+ inserted 持久 | ✅ |
| 10 | 冲突保护 | 生成后改正文 → 插入 409 → 确认条 → force 重发成功且用户内容保留（DocumentConflict 语义） | ✅ |
| 11 | 错误人性化 | humanizeError 映射（AiNoApiKey/AiRateLimited/…标题+怎么办）；停止→stopped 保留已生成 | ✅ |

### Journey ④ sync 文件级推送
| # | 环节 | 验证点 | 结果 |
|---|---|---|---|
| 12 | 配置 + 推送 | WebDAV 配置（mock 连接成功）→ 立即推送 pushed=1（空正文跳过） | ✅ |
| 13 | autoSync | PATCH 开关落库 + 正文保存后自动触发（fire-and-forget） | ✅ |

### Journey ⑤ websearch 引用入文
| # | 环节 | 验证点 | 结果 |
|---|---|---|---|
| 14 | 引用回流 | 搜索（降级 2 条）→ 勾选 2 条 → 引用入文 → chat 消息 `【引用资料】标题（来源）：摘要…\n来源：URL` 多条合并 | ✅ |

## 质量数据（V1.1 增量）
- 契约测试：**139/139**（17 文件，V1.0 109 → +30）
- 迁移：0010（styles）/ 0011（chapters.content）/ 0012（chapter_messages），05.5 追踪表流程，无重放
- 新端点：/api/v1/styles CRUD、章节正文 GET/PATCH、章节对话 messages/chat SSE、insert、sync/push、sync/config PATCH
- Milestone Gate：tsc + 全量 + build 全绿
- 契约：23 组端点全部入契约（api-contract.md）

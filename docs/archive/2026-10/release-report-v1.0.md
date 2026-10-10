# 墨舟 (MoZhou) V1.0 Release Report

- **版本**: v1.0.0-full-real
- **日期**: 2026-08-11
- **分支**: main（38+ 提交）
- **性质**: 全站 13 界面 100% 真实 API 接入 · 通过人工验收

## 交付范围（User Journey）
1. 邮箱注册/登录（JWT httpOnly + bcrypt）
2. 小说项目管理（作品/人物/世界观/章节 CRUD + RAG 开关）
3. 写作对话（SSE 流式 + 作品绑定 RAG 注入 + 风格/技能胶囊 + 内联抽卡 + 上下文自动压缩）
4. 风格蒸馏（LLM 四维风格指南）
5. 小说拆解（LLM 结构/剧情/节奏）
6. 书源搜索 + 书架（三书源检索 + 容错降级 + 导入落库）
7. 技能广场（技能 CRUD + 广场源 + chat 注入）
8. 写作机检（六项真实检查）
9. 联网搜索 / 网文扫榜（外部源超时降级）
10. 云同步（WebDAV 配置 + 真实连接测试）
11. 会员中心（真实用量记账 + 抽卡 402 gating）

## 质量数据
| 项 | 值 |
|---|---|
| 契约测试 | **109/109**（14 文件） |
| Lint | 0 errors / 0 warnings |
| TypeCheck | ✅ |
| Production Build | ✅（35 路由 standalone） |
| Manual Acceptance | ✅ 17/17（核心 User Journey 实测） |
| Migrations | 0000-0009（含追踪表） |
| API 端点 | 21 路径 / 29 操作（openapi.yaml） |

## 架构与工程
- Next.js 16.3 + TS + Tailwind + Drizzle(pgvector) + Postgres + one-api 网关
- 管线引擎（reducer 状态机 + 校验重试 + 记账）
- UVSD Protocol v2.2.1 全流程（spike 落盘 / 契约驱动 / 纵向切片 / 双档 Gate）
- 部署：Dockerfile（standalone）+ compose prod profile + docs/deployment.md

## V1.1 候选（不在 V1.0 范围，均已标注）
- 会员支付（收款渠道）
- projects 审查记录 / 导出备份
- 书源 HTML 规则解析器（Yuedu 规则）
- sync 文件级同步执行
- websearch 引用入文写回
- 风格库持久化
- 章节级续写（绑定作品按章）

## 已知限制
- sync 密码明文存储（schema 已标注，上线前需加密列）
- 外部榜源/书源解析为简化版（title 提取）

# 墨舟 V1.3 工作台轮 Release Candidate（2026-08-15）

> 状态：**READY FOR DEPLOYMENT REVIEW** —— 本地门禁全绿、浏览器验收通过、候选镜像构建中；
> **生产切流需独立人工批准**（UVSD 规则 24 + 历史惯例），本文件只提供候选与证据，不执行部署。

## 1. 范围与提交

| Commit | 内容 |
|---|---|
| c5c012c | docs: workbench-a spec/tickets + ADR-0006（Skill 运行时契约 FROZEN + A 版决策落仓库） |
| c32885a | 工单 01：Skill 运行时骨架 + 故事状态技能（四表 0022/0023 + 种子 + lib/runtime + 接线 + 证据端点） |
| c5b2da4 | 工单 02：章节规划技能（chapter_task_card + planner 区段 + 讨论期跳过） |
| f355716 | 工单 03：质量门技能（post_write 两组检查 + check_report 落 runtime_artifacts 0024） |
| ccefd59 | 工单 04-06：叙事声音执行器 + MarketBrief 版本化绑定（0025）+ BenchmarkPack 方法包 |
| 1e18fb2 | 工单 07：A 版双栏创作台（桌面三栏 + 移动端底部导航 + 链路证据抽屉） |

## 2. 数据库迁移（生产执行前必须人工确认）

- 0022_skill-runtime（四表 + 5 内置技能种子）
- 0023_skill-runs-run-id
- 0024_runtime-artifacts
- 0025_artifact-bindings
- 本地 dev DB 已应用（0022-0025）；生产 Neon 迁移**不自动执行**（UVSD 规则 24）。

## 3. 门禁证据

| 门禁 | 结果 |
|---|---|
| tsc --noEmit | 0 错 |
| unit 全量（40 文件） | 211/211 |
| http 全量（17 文件） | 147/148 —— 唯一失败为既有环境性用例：source.test.ts 断言「mock 下番茄搜索必降级」，本机直连番茄可达（ok/degraded=false/10 条真实结果）；与本次改动无关（search 路径未触碰），按规范未改测试 |
| next build | 通过（47 路由，含新证据端点与工作台） |

## 4. 浏览器验收（真实 Chrome，chrome-devtools MCP，dev server mock provider）

- 桌面：A 版三栏渲染；AI 先提问先于模板选择；选择作品 → 左栏/最近正文刷新；发送消息 → 右栏出现完整链路：
  故事状态 applied（owner_context · 8 tokens）/ 章节规划 degraded「无可用规划数据」/ 读者与题材 skipped「未绑定市场简报」/ 叙事声音 skipped「未选择风格」/ 质量门 applied；ContextAssembler 统计；5 默认技能状态；绑定参考展示。
- 移动端（375px）：左右栏折叠；底部导航（写作/章节/故事/工具）可用；「本次链路」抽屉显示完整证据；章节二级面板可用。
- 无作品空态保留（创建作品引导）。

## 5. 候选镜像

- 构建：`docker build --build-arg BASE_IMAGE=docker.1ms.run/library/node:22-alpine -t mozhou-web:ticket08-candidate .`（镜像源受限环境覆盖，见 docs/production-deployment.md）
- 容器 smoke：本地端口跑候选镜像，/login、/register 200（见下节命令）。
- 部署 runbook 沿用 docs/production-deployment.md（gcloud auth configure-docker → push AR → gcloud run deploy → canary 0% smoke → 100% 切流 → 旧 revision 保留回滚）。

## 6. 生产切流（BLOCKED-on-human）

- 需要人工：生产迁移 0022-0025 执行、Cloud Run 部署、Secret 注入、canary smoke、100% 切流。
- 回滚：旧 revision 保留（沿用既有 mozhou-web revision 列表）。

## 7. 未决项

- 公共模板市场（BenchmarkPack 公开化）二期。
- 自定义技能完整执行器体系（输入契约声明 UI）二期；现状：未声明契约 → UI 标记未接入（skills API connected=false）。
- source.test.ts 环境性用例：建议后续将该用例改为注入不可达 fetch 的确定性降级测试（另行工单）。
- 单书趋势曲线页/题材榜全量（08-14 决策，二期）。

## 8. 容器 smoke 命令（人工可复跑）

```powershell
docker run --rm -d --name mozhou-candidate -p 3211:3000 ^
  -e DATABASE_URL=postgres://mozhou:mozhou_dev@host.docker.internal:5433/mozhou ^
  -e AUTH_SECRET=<本地临时密钥> -e ONEAPI_BASE_URL=http://host.docker.internal:3001 ^
  -e ONEAPI_TOKEN=dev-token mozhou-web:ticket08-candidate
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3211/login
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3211/register
```

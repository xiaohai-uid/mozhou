# 墨舟 (MoZhou) 可用版本收口交付验收报告

- 验收基线：GitHub `xiaohai-uid/mozhou` master (`b2a0930de936d79839cb15b686edb0a450c49001`)
- 交付分支：`delivery-closure-20260905`
- 交付范围：T00–T11 本地单用户写作完整闭环
- 状态：**全部测试通过 · 真实生产包解压验证通过 · 0 循环依赖**

---

## 1. 核心闭环验收矩阵

| 场景 | 必须观察到的行为 | 验证证据与结果 | 结论 |
|---|---|---|---|
| **全新启动建书 (F01/T01/T02)** | 新书创建于长期书库而非 `/tmp`，第一章正文及大纲物理文件立即可用，彻底消除 ENOENT。 | HTTP POST `/api/book` 返回 200，目录位于 `~/MoZhou/Books/<UUID>`，`正文/第一卷/第0001章.md` 存在且 `phase: draft`。 | **PASS** |
| **向导约束实际落盘 (F04/T05/T06)** | 世界规则、卷承诺、开场、首章目标 4 项设定持久化至 `设定/作者意图.md`，并在模型 Prompt 中作为结构层注入。 | 探针测试证实特异标签 `RULE_SHADOW_CURSE_999` 等四项写入文件并在流式 start 帧 prompt 中精准呈现。 | **PASS** |
| **真实草稿流式生成 (T01/T08)** | 接收 start/delta/done 完整帧，明确成功终态，正文原子落盘。 | 探针测试接收完整 NDJSON 事件，盘上正文与 delta 文本哈希逐字节对账一致。 | **PASS** |
| **非破坏性续写 (F02/T03)** | 激活 `continuation` 时自动识别已有正文，保持前文不覆盖，新生成内容追加在后。 | 探针测试预置“AAA”，带 continuation 生成“BBB”，盘上正文最终为“AAA\nBBB\n”，严格保持前序。 | **PASS** |
| **手工编辑与安全保存 (F05/T04)** | 支持手工编辑正文，哈希保护防并发冲突，落盘步进 revision 并记入领域审计。 | 真实探针测试：修改“手动修改稿”，返回新 revision 与 hash；使用过期旧 hash 保存被 409 `HASH_MISMATCH` 拦截。 | **PASS** |
| **并发冲突互斥保护 (T03/T04)** | 同一部书同一章节同时只能有一个写入流或编辑保存任务，并发请求被 409 拦截。 | 双连接并发测试：前一个返回 200，后一个返回 409 `{ ok: false, code: 'WRITE_IN_PROGRESS' }`。 | **PASS** |
| **流异常中断诚实呈现 (F07/T08)** | 上游未发 `[DONE]` 提前断开或网络异常时，抛出 `PrematureStreamTerminationError`，UI 停在错误态，绝不展示“完成”。 | 单元测试及生产流组件断流测试：明确捕获 PrematureStreamTerminationError，UI 显式 role="alert" 报错。 | **PASS** |
| **刷新与冷启动恢复 (F09/T04/T08)** | 服务彻底关闭并重新启动，或页面刷新后，`chapterIndex` 与正文内容从磁盘及 localStorage 恢复逐字一致。 | 探针测试：杀死服务 1，启动服务 2，重新读取章节与正文，内容与 hash 和停机前逐字相等。 | **PASS** |
| **全书正文依序导出 (F05/T10)** | POST `/api/export.txt` 依序读取所有已建章节，生成带书名和规范标题的 TXT 纯文本，提供一键下载。 | 真实探针测试：2 章节书导出生成 252 字节本地 TXT 文件，首尾标题与正文顺序严格一致，消除“尚未接入”占位符。 | **PASS** |
| **质量检查状态对齐 (F06/T09)** | 新建书未审阅时显示“尚未运行检查”，不误报“已 stale”；review 与 quality 接口平铺契约统一。 | 探针测试：未审阅时 `hasReport: false, status: 'no_review', current: true`；审查后质量指标平铺字段与 review 100% 对齐。 | **PASS** |
| **BYOK 优先级隔离 (F08/T07)** | 仅配 `OPENAI_API_KEY` 时默认指向 `https://api.openai.com/v1` 和 `gpt-4o-mini`，绝不回落到 DeepSeek。 | 6 项自动化单测与脱敏探针测试：各模式严格隔离，双 Key 未声明 provider 显式报错。 | **PASS** |
| **全新解压生产包冒烟 (T11)** | 在脱离源码 node_modules 的干净临时目录解压生产包，使用 `--prod` 启动并跑通全流程。 | `scripts/test-clean-unpack.mjs` 测试：从 `mozhou-v0.1.1-local-runtime.tar.gz` 解压、1.5s prod 安装、启动服务、跑通端到端 smoke 脚本。 | **PASS** |

---

## 2. 自动化门禁测试结果

- **核心包测试 (`pnpm test`)**：90 文件，726 测试全部通过 (0 失败，0 跳过)
- **Web 端测试 (`pnpm --filter @mozhou/web test`)**：33 文件，226 测试全部通过 (0 失败)
- **总测试用例数**：**952 项自动化测试 100% 通过**
- **代码规范检查 (`pnpm lint`)**：ESLint 9.39.5 全仓库 0 错误、0 警告
- **类型检查 (`typecheck`)**：TypeScript 5.5.4 0 错误
- **GitNexus 架构依赖检查**：`npx gitnexus check --cycles`：`status: clean, cycleCount: 0`

---

## 3. 发行资产清单

运行 `node scripts/build-release.mjs` 生成的生产验证资产：
1. `release-artifacts/mozhou-v0.1.1-local-runtime.tar.gz` (自包含生产运行时包，含启动器与 smoke 探针)
2. `release-artifacts/mozhou-v0.1.1-web-dist.tar.gz` (纯静态前端包)
3. `release-artifacts/mozhou-v0.1.1-docker.tar.gz` (Docker 部署包，预配置 `/data/books` 持久化 volume 与 node 用户所有权)

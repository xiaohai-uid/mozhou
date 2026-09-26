# 墨舟 v0.3.0 发布验收报告（Technical Preview）

> 日期：2026-09-26 · 源提交：`develop` HEAD（见下） · 类型：本地优先 Technical Preview 发布验收
> 依据：`docs/specs/spec-mozhou-novel-os-2.0.md`（产品基准）+ `specs/004-commercial-app-masterpiece/spec.md`（商业 UI 工作流，任务全勾）+ `docs/superpowers/plans/2026-09-15-full-release/`（发布纪律与范围裁决）+ `docs/release-hardening-2026-09-03.md`（发布门禁清单）

## 0. 发布范围裁决

按 2026-09-15 计划 §6：公网网站、支付（微信/支付宝）、Windows 安装包、独立安全复验（T08/T14/T16/T17/T19/T21）因外部条件（商户资质/服务器/签名/独立审阅人）为 **blocked**，纪律禁止以降级实现冒充。故本次发布为**既成的 Technical Preview 通道**（v0.1.0/v0.1.1 同一方式）：本地运行时 + Web dist + Docker 三包，社区免费版，不开放购买。

## 1. 验收结果

### 1.1 静态与测试门禁（源提交 c1b8b29+，最终 HEAD 全部复跑）

| 项 | 结果 |
|---|---|
| `tsc -b`（全仓） | ✅ 0 错误（004 SC-1） |
| eslint（typed-lint，零 any/@ts-ignore） | ✅ 0 错误 |
| workspace vitest | ✅ 856/856 |
| apps/web vitest | ✅ 619 过 + 1 如实 skip（真机冒烟，无 Key 环境按设计跳过） |
| GitNexus `check --cycles` | ✅ 无循环依赖（004 SC-2） |
| `pnpm audit --audit-level high`（官方 registry） | ✅ 0 high/critical；2 moderate 均为 vitest devDependency（不在生产运行路径，修复需 vitest 3→4 大版本，列已知风险） |
| L1 50 章确定性台架 | ✅ 含冻结判据 `durationMs < 5000`（实测 ~1.5-1.9s） |

### 1.2 规格符合性（逐条实证，非文件存在性推断）

- **十步管线 / 5 项机械门禁 / 三通道 RRF / SQLite WAL / 双平面重建**：由 856 条 workspace 测试与 50 章 L1 台架覆盖（全绿）。
- **商业 UI（004）**：TipTap 编辑器组件与遥测（组件测试 ✅）、流派工坊路由注册（`views.test.ts` ✅）+ 后端 `applyGenreKitToBook`（data-plane 测试 ✅）、正典图谱契约创建走 `/api/story-brain.contract` 真实落盘。
- **诚实性（Spec 硬约束）**：无 Provider 时 UI 显式「Gate 3 不可用」、`verify:real-model` 无 Key 时输出 BLOCKED 拒绝伪造、会员目录 Pro/Max 显式不可购买——均实测确认。

- **L2 真模型三连冒烟（ADR-0018）**：使用用户知识库提供的 SenseNova 免费通道（`deepseek-v4-flash`，密钥仅经环境变量注入，未落任何文件），`pnpm verify:real-model` **3/3 VERIFIED**（188/246/292 字真实 prose，含两次 medium 风险正典提案的作者裁决路径），证据 `evidence/real-model-journey/2026-09-26T15-2*/`。此前脚本缺 S6 提案裁决步导致 2/3 假失败，已补（见 §2.4）。

### 1.3 核心用户旅程（真实 UI + 真实 HTTP + 真实磁盘）

浏览器实测（Chrome，本机 5198 端口生产构建）：首启五步向导建书 → 工作台绑定《发布验收之书》 → 编辑器实时质量遥测（字数/4-gram/De-AI 分） → Accept 落稿 → 磁盘 `正文/第一卷/第0001章.md` 带正确 frontmatter（revision/phase/originAuthor）。
HTTP 冒烟（发布包内）：`/` 200、`/api/membership` 诚实目录、`/api/health` 200、真实建书 ✅。

### 1.4 容器与数据安全

- Docker 镜像（当前 HEAD）构建 ✅ → `healthy` ✅ → `docker stop`（SIGTERM）→ 日志含 `shutdown.start`+`shutdown.drained`、exit 0、714ms——**优雅停机在 Linux 信号环境实证**（此前仅 Windows 无法验证）。
- 命名卷 `mozhou-data` 持久化：写入标记 → `compose down` → `up` → 数据存活 ✅（P0 数据丢失修复的端到端复验）。
- `MOZHOU_SECRET_KEY` 缺失时生产模式 exit 1 拒绝启动 ✅。
- fsync 原子写、备份/恢复 SHA-256、外部修改检出、投影可弃重建：由 data-plane 测试套件覆盖 ✅。

## 2. 本次验收发现并已修复的发布阻断项

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 1 | P1 | `/api/story-brain.contract` 直写 canon 追踪流不刷基线 → 作者建契约后对账误报 EXTERNAL_MODIFIED | `LocalDataPlane.absorbAppWrite` + 路由收口 + 含反向对照的回归测试 |
| 2 | P1 | 本地建书缺省落 `/tmp/mozhou-book-<ts>`（Windows 实际落 C:\tmp），脱离数据根、不入书架、不随卷 | 服务端默认落 `<dataRoot>/books/`，显式 dir 仍尊重；UI 级复验 |
| 3 | P0（发布通道） | `build-release.mjs` 的 tar 用绝对路径当 `-f` 参数，GNU tar 将 `C:` 解析为远程主机 → `pnpm build:release` 在 Windows 从未成功 | `-f` 改相对 cwd 文件名，三处统一，构建实测通过 |

（c1b8b29 之前的会话已完成：数据卷持久化、主密钥 fail-fast、fsync 屏障、健康端点/日志/优雅停机、Dockerfile patches 缺失、部署文档对齐、版本对齐——见 git log 6feb605..1cd9a88。）

## 3. 发布资产（本机构建，源提交见 git log HEAD）

- `mozhou-v0.3.0-local-runtime.tar.gz`（解压后 Windows 运行 `启动墨舟.bat`，Linux/macOS `./start.sh`）
- `mozhou-v0.3.0-web-dist.tar.gz`
- `mozhou-v0.3.0-docker.tar.gz`（内含 Dockerfile/compose：`MOZHOU_SECRET_KEY` 必填 + `mozhou-data` 数据卷 + healthcheck）
- `SHA256SUMS.txt`（与 CI release.yml 同法生成；正式发布以 CI 重建资产为准）
- SBOM 由 release.yml 的 anchore action 在 CI 生成（本地不复现）。

## 4. 已知风险与未验证项（无 P0/P1 阻断，如实列出）

1. ~~L2 真模型冒烟未跑~~ **已收口**：知识库密钥授权后三连真实冒烟 3/3 VERIFIED（见 §1.2 末条）。T18 的 500 章/150 万字规模与 2 小时负载验收仍属计划内 blocked（需要专项预算）。
2. **独立安全复验（T19）未做**：计划要求实施者之外的人签署；本报告不构成安全签核。
3. **Windows 信号停机不可验证**：优雅停机已在 Linux 容器实证；Windows 原生 SIGTERM 语义受平台限制（会走 `exit` 钩子收口，但不做请求排空）。
4. **Tauri 桌面安装包（004 SC-4 / T17）**：未发布亦未验证（Rust 工具链在本机但 Tauri CLI 未锁定为 devDependency）；README 已声明 Tauri 安装是独立发布面。
5. **vitest 2 个 moderate 漏洞**：devDependency，生产运行时不受影响。
6. **favicon 404 与两处表单可访问性提示**：浏览器控制台已知小疵，无功能影响。
7. **`docs/production-deployment.md` 为已作废历史档案**（含作废横幅），不得照其操作。
8. **公网/hosted 部署不可用**（loopback Host 门禁 + T16 blocked）：`deploy/README.md` 已置状态警告；是否放开需产品决策。

## 5. 结论

最终 Spec 的关键要求（内核/上下文/提交事务/双平面/诚实性/机械门禁/50 章台架）与 004 商业 UI 工作流关键交付已实现且实际验证通过；构建、类型、lint、测试、依赖审计、循环依赖门禁全绿；无已知 P0/P1 阻断；未验证风险已全部列明。满足 Technical Preview 发布条件，发布通道（push gate → CI → draft Release）见下文执行记录。

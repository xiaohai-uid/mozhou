# CHG-20261010-15 文档结构整理：补两份缺失指南，归档 28 份历史报告

> 触发：用户提供「Vibe Coding 推荐文档配置」图（8 个文件槽位），询问墨舟能否照此划分；用户选定方向 2「补缺 + 归档沉淀」。基线 HEAD `8be2dc7`。

## 1. 需求来源与一处自我更正

用户询问是否按图中的 8 槽位（AGENTS.md / DESIGN.md / TODO.md / project-overview.md /
architecture.md / user-guide.md / development.md / component-api.md）重组本仓文档。

**我第一次盘点时报告「`DESIGN.md` 缺失，可新建」——这是错的。**
只查了仓库根目录，漏了 `apps/web/DESIGN.md`。该文件存在、385 行，且质量合格：
设计命题、2026-09-21 批准的视觉基线、权威顺序（`GLOSSARY.md` → ADR-0027 →
`globals.css` → 真实组件）、密度规则与失败态契约，且显式声明不授权路由迁移或组件库迁移。
本轮核实其引用的 4 条路径全部有效、声明的 token 与 `globals.css` 逐值一致
（`--background #080b11`、`--accent #cda56d`、`--jade #7fb5b2`）。
**据此取消新建 `DESIGN.md` 的计划。** 另有 `apps/web/prototypes/ink-realm/INK_REALM_DESIGN_SYSTEM.md`
（216 行）作为下级细化，同样无需另立。

## 2. 判断：8 槽位里 3 个不应照搬

| 槽位 | 决定 | 依据 |
|---|---|---|
| 03 `TODO.md` | **不建** | `AGENTS.md` §9 规定执行状态唯一权威是 GitHub Issues；建 `TODO.md` 等于在仓库里放第二个进度源（ADR-0032/0034 反复清理过这类重复） |
| 04 `project-overview.md` | **不建** | `README.md` 已承担该角色（155 行，含版本声明与能力边界） |
| 08 `component-api.md` | **不建** | 组件契约由 `packages/*/src/*.ts` 导出类型 + 测试维护，不靠 md；对应物是 `.scratch/mozhou-mvp/contracts/api-contract.md`（后端契约） |

## 3. 实际变更

### 新建 2 份

| 文件 | 内容 | 来源 |
|---|---|---|
| `docs/user-guide.md` | 面向作者：是什么 / 安装（Windows 安装器 + 源码）/ 首次使用 / 数据位置 / 故障排查表 / 已知边界 | 合并 `docs/install.md` + `docs/windows-local-install.md` + README 用户段落。**原文件保留未删**（`install.md` 仍是打包基线的紧凑参考） |
| `docs/development.md` | 面向贡献者：环境 / 常用命令（开发·推送前门·生成物·图谱·打包）/ 改动纪律 / **回滚清单** / 分支模型 / Windows 注意 | 新写，命令逐条实测 |

### 归档 28 份到 `docs/archive/<year>/`

`docs/` 一级从 34 份降到 9 份；仓库根从 7 份降到 6 份。

- `2026-08/`（22 份）：商业化就绪度、全材料审计、Web AI 交接、四项目验收矩阵、生产栈对比、
  V1.2 上下文契约修复计划、V1.3 RC 证据、`production-deployment.md`（已作废栈）
- `2026-10/`（6 项）：`MOZHOU_MODULE_ARCHITECTURE_AUDIT.md`（640 行，原在仓库根）
  与其复核批次 `audit-2026-10-03/`（20 文件）、v0.3.0–v1.2 发布报告、W3 运营实施报告

用 `git mv` 移动，**内容零修改**，历史完整保留。`docs/archive/README.md` 记录原路径与归档原因。

**为什么归档是真问题而非整理癖**：根目录压着 640 行审计报告、`docs/` 一级并排放着
`release-report-v1.0.md` 与当前门清单——旧报告与现状同级，读者容易拿历史当依据。

### 指针更新

- `AGENTS.md` §7：新增两行（用户/开发指南、界面契约；历史档案）
- `README.md`：新增「怎么用」入口行；v0.3.0 修复摘要里指向已归档文件的那行**不改写**，
  按规程追加追记（历史陈述保留原值）
- `docs/deployment.md`、`docs/project-data-package-v1.3.md`、`docs/adr/0035`：修正指向已归档文件的链接

## 4. 一处被文档掩盖的过时断言

`docs/install.md` 写「better-sqlite3 的 ABI 绑定 22.23.2，其他版本测试会挂」。
本轮实测：Node **24.18.0** 下 `better-sqlite3@12.11.1` 正常加载（`:memory:` 建表成功），
`pnpm build` / `pnpm test` 全绿。两个版本都可用。

`docs/development.md` 如实记录两个版本均实测通过，并写明**改动 Node 版本时须重新验证
native 绑定，不要只信文档**。`docs/install.md` 原文保留未改（它仍是打包基线的紧凑参考）。

## 5. 验证（全部实跑）

- `node scripts/verify-glossary.mjs` → exit 0（新文档在活跃层，术语门扫过）
- `node scripts/verify-gates-contract.mjs` → exit 0
- `node scripts/verify-package-readmes.mjs` → exit 0
- 死链扫描（自写脚本，对 `README.md`/`AGENTS.md`/`PROJECT-MAP.md`/`docs/*.md`/
  `docs/adr/*.md`/`docs/changes/*.md` 逐个解析 markdown 链接并验证目标存在）：
  修前 2 处、实际死链 1 处（`docs/adr/0035`），修后 0 处。
  另 1 处为**误报**——`CHG-20261008-24` 中的 `` `docs/adr/0031-...` `` 是行内代码非链接，
  目标文件存在。
- 归档前核实活指针：22 份候选中仅 `w3-operations-implementation-report` 被
  `PROJECT-MAP.md` 引用 2 处，且均在**已完成的历史 CHG 记录正文**内，非活指针。

## 6. 未做与遗留

- `docs/install.md`、`docs/windows-local-install.md`、`docs/project-data-package-v1.3.md`
  保留原位：新文档是入口，不是取代。后续若确认无独立价值再议删除。
- `docs/audit/`（6 份 2026-10-02 报告）未并入 `docs/archive/`——`PROJECT-MAP.md` 地图索引
  仍点名该目录，合并需同步改索引，超出本轮范围。
- 归档目录内部的相对链接（如 `mozhu-full-materials-audit-report` 的 6 处）未改写——
  档案内部指向历史语境，不影响当前导航。
- 门清单与 `docs/gates.md` 未变：本轮无门的新增、删除或契约变化。
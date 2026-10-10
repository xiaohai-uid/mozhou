# CHG-20261006-17 依赖安全升级与推送门禁前置修复

> 本文件是变更 CHG-20261006-17 的证据记录。触发原因：`git-push-gate` 在 `ci.yml` / `novel-os` 上 BLOCKED，需先消除阻塞项再推送。

## 1. 触发与定性

推送前本地 CI 门禁（act 容器实跑 `ci.yml`）在第 5 步 `pnpm audit --audit-level high` 失败：

- 报告 **9 个漏洞：6 moderate / 1 high / 2 critical**。
  - critical ×2 — `tinypool`（原型污染 gadget 致 RCE），路径全部经 `vitest@3.2.7 > tinypool@1.1.1`；
  - high ×1 — `source-map-js@1.2.1`（事件循环 DoS），路径经 `vitest → vite@6.4.3 → postcss@8.5.26`。
- **定性为既有依赖债，非本批次引入**：`source-map-js@1.2.1` 与 `tinypool@1.1.1` 在基线 `40cd257`、远端尖 `979f1cfa` 与 HEAD 三处锁文件中逐字一致；`git diff 40cd257..HEAD -- pnpm-lock.yaml` 对 vitest/tinypool/source-map-js/postcss **零命中**。

## 2. 修复内容

### 2.1 依赖安全（本次核心）

- `tinypool` 无 1.x 修复版（公告仅给 `>=2.1.1` / `>=2.1.2`），而 **vitest 4.x/5.x 已不再依赖 tinypool**；故升级 `vitest` `^3.2.7` → `^4.0.4`（实际解析 4.1.11）。
  - 选 4.x 而非 5.x 的依据：`vitest@4.0.4` 声明 `vite: ^6.0.0 || ^7.0.0`，与本仓 `vite@6.4.3` 兼容；5.0.x 刚替换 chai/tinybench 内核，回归面更大。
  - 涉及 5 个 package.json：根、`apps/web`、`packages/benchmark`、`packages/flywheel`、`packages/quality-engine`。
- 新增 pnpm override `"source-map-js": "1.2.2"`（patch 级，仓库已有 tar/js-yaml/fast-uri/brace-expansion 同类先例）。
- 结果：锁文件中 `tinypool` 计数归 **0**，`source-map-js` 为 **1.2.2**，`vite` 仍为 6.4.3。

### 2.2 本批次引入的 lint 失败（同批修复）

`pnpm lint` 报 9 个错误，全部集中在 C9 新建的 `scripts/verify-longform-e2e.mjs`：5 处未使用导入、1 处未使用变量、3 处空 `catch` 块。已删除未使用绑定并为空 catch 补注释。

> 说明：此前各阶段的 `pnpm lint` 是在该文件创建之前跑的，故未覆盖到它。

### 2.3 文档门禁前置修复

- `docs/architecture.md`、`docs/term-map.md` 过期（本批次后续提交新增代码所致），经 `pnpm gen:architecture` / `pnpm gen:term-map` 重新生成。
- `check:glossary` 的裸 ADR 引用预算（54，只许减不许增）在**基线即为 56**（远端尖 `979f1cfa` 更高达 87），属既有债。本次消歧 5 处：`docs/specs/dual-plane-sync-spec.md` 的 0006 号裸引用×2 → `K-0006`、`docs/specs/change-impact-engine-spec.md` 的 0003 号裸引用×3 → `K-0003`。归属依据为 ADR 标题（K-0006 "Local Data Plane…"、K-0003 "Dependency Manifest and Deterministic-First Change Impact Engine"）与所在文档主题逐字对应。计数降至 **51**。

## 3. 验证（本地实跑）

| 命令 | 结果 |
|---|---|
| `pnpm run test:packages` | 117 文件 / **1048 用例通过** |
| `pnpm --filter @mozhou/web test` | 149 文件通过 / 1 跳过，**1098 用例通过 / 14 跳过** |
| `pnpm build`（`tsc -b`） | exit 0 |
| `pnpm --filter @mozhou/web typecheck` | exit 0 |
| `pnpm lint` | exit 0（修复前 9 errors） |
| `pnpm --filter @mozhou/web build` | 成功（1.87s）——需将 TEMP 指向仓库内目录 |
| `check:glossary / architecture / gates / term-map / readmes` | 5/5 PASS |

**环境性说明**：`vite build` 在本机 `%TEMP%` 下报 `esbuild … remove … Access is denied`（本机 C 盘 SSD 坏块/权限问题的表现），改 `TEMP` 到仓库内即成功；`esbuild@0.25.12` 在基线与 HEAD 完全相同，与本次变更无关。`pnpm audit` 无法本地执行（本机 registry 为 `registry.npmmirror.com`，无 audit 端点），故审计结论以 act 容器内的真实结果为准。

## 4. 风险与回滚

- **风险**：vitest 3→4 为跨主版本升级。本仓 vitest 配置仅用稳定 API（`include`/`environment`/`globals`/`setupFiles`/`testTimeout`/`coverage.provider`），迁移面小；全量 2146 用例升级后逐项通过，数量与升级前完全一致。
- **回滚**：`git revert <本提交 SHA>`（或整体回退：`git checkout 40cd257 -- package.json apps/web/package.json packages/*/package.json pnpm-lock.yaml` 后 `pnpm install`）。

## 5. 未覆盖

- `pnpm audit` 未在本地复验（registry 无 audit 端点），仅由 act 容器结果证明。
- `security.yml` 的 `secret-scan`（gitleaks）与 `sbom` 未纳入本地门禁验证（门禁一次只验证一个 workflow）。

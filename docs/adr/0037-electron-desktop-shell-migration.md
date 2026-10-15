---
status: accepted
date: 2026-10-12
description: '把桌面发行面从「手工 Inno/C# 启动器 + 未接线的 Tauri 壳」迁到 Electron（Windows x64 先行）；服务端仍为独立官方 Node 子进程；切换发行入口前必须先补三份合同（浏览器数据迁移、实例与端口、安装升级回退），旧链路最后退役'
tags:
  - mozhou
  - desktop
  - release
---

# 0037. Electron 桌面壳迁移（Windows 先行）

- **状态**：Accepted
- **日期**：2026-10-12
- **来源**：用户决定「技术栈转为 Electron」；修订稿吸收了外部评审的两份意见（`Electron迁移方案-锐评.html`、`Electron迁移方案-修订建议.md`），并已逐条核对本仓源码
- **前置**：ADR-0030（本地 API 信任模型）、ADR-0031（单一流程权威）

## Context

2026-10-12 的只读调查（三个探查代理 + 定点源码核对）确认了桌面发行的真实现状：

| 路径 | 事实 |
|---|---|
| `src-tauri/` | 完整可编译的 Tauri 2 壳（`main.rs:24-101` 找端口→拉起 Node 服务→健康检查→webview 导航；`server_manager.rs:219-230` Windows Job Object 父死子死）。但**无任何 `package.json` 依赖**、lockfile 零条目、无 workflow 构建、任何发行产物都不含它；`server_manager.rs:152-153` 自述不在 Windows 发行包内 → **死路径** |
| `scripts/release/windows/` | **活的手工链路**：`build.mjs` 物化生产依赖树 + 打包 `node.exe` + `csc.exe` 编译 `MoZhou.cs`（托盘启动器，**开系统浏览器**）+ Inno Setup 6。产物 128MB 未签名，**不在 CI** |
| `.github/workflows/release.yml` | 另一条发行面：三个 tar.gz + SBOM，与安装器无关 |

用户选择 Electron 的理由是：需要真正的应用窗口与统一的桌面生命周期，且构建机不应再依赖 `csc.exe` 与 Inno Setup 两个非 npm 工具。

**必须更正的一处常见误判**：用户现有安装器**已经**打包了 Node（`build.mjs:87-88`），所以「免装 Node」不能重复算作 Electron 的收益。真正被替换的是「开系统浏览器 + 手工 Inno/C#」这条壳与打包路径。

## Decision

1. **壳用 Electron，Windows x64 先行**；macOS/Linux 不在本期（写入锁在 macOS 直接抛 `WRITER_LOCK_UNSUPPORTED_PLATFORM`，需先补实现）。
2. **服务端保持独立子进程**，继续用打包的官方 Node 跑 `productionServer.js`；壳不加载服务端原生模块（`better-sqlite3` / `onnxruntime-node` / `@anush008/tokenizers` 及 `fastembed` 补丁均按官方 Node ABI 预编译）。依赖与资源置于 asar 之外。这避免直接耦合 Electron ABI，**但不免除**原生 DLL、模型资源与部署依赖树的实测。
3. **六条不变量**（详见迁移计划）：内容完整、存储身份明确（URL 与持久 profile 分别固定）、目录与密钥完整（有密文缺 key 必须拒绝启动）、单一写服务（跨代停止须互通）、独立 Node、退出与恢复（不得用进程消失代替提交成功证据）。
4. **切换发行入口前必须先交付三份合同**：旧浏览器数据迁移、实例与端口、安装升级与回退。缺任一份不得切换默认入口。
5. **退役放在最后**：先通过干净安装、存量迁移、Inno 升级、异常、重装与回退矩阵，再切 `package:windows`，最后删除无人消费的旧入口。保留可取得的旧版本与迁移助手。

## Alternatives

| 方案 | 取舍 |
|---|---|
| 维持现状（Inno/C# + 开系统浏览器） | 保持零迁移成本；但构建机继续依赖 `csc.exe` 与 Inno Setup，无真正的应用窗口，且无法自动化未签名构建验收 |
| 启用已有 Tauri 壳 | 壳代码已完成，包体小于 Electron；但它从未接线、无依赖锁、无 CI，且要引入 Rust 工具链与另一套打包链——对当前维护面是净增 |
| **Electron（选中）** | 换取真正的窗口/托盘/单实例与标准打包链，并为自动更新与跨平台留路径；代价是包体变大（Chromium）与新的升级合同 |

**未实测（标 unverified，阶段 3 实测后再写入结论）**：压缩安装包体、安装占用、冷启动时间、空闲内存。估算不作为验收事实。

## Consequences

- 正面：单一桌面发行入口；构建机去掉 `csc.exe` 与 Inno Setup；窗口内加载 `http://127.0.0.1:<稳定端口>` 保留现有 origin 契约；为自动更新留出标准路径。
- 负面：安装包显著变大；需跟踪 Electron 安全更新节奏；新增 Inno→NSIS 的升级与回退合同（旧卸载器与新程序不得有危险目录重叠）；未签名状态不变，签名仍单列缺口。
- 中性但必须处理：**Electron 的 session 有自己的存储目录，相同 URL 不会继承旧 Edge/Chrome 的 localStorage** —— 旧未保存草稿、AI 候选、保存基线与编辑器结构必须单独迁移，这是本决策 P0 级的前提。

## References

- 迁移计划与三份合同：[`docs/plans/2026-10-12-electron-desktop-migration.md`](../plans/2026-10-12-electron-desktop-migration.md)
- 机制依据（2026-10-12 经 AnySearch 核对）：Electron `app.getPath`/`session.fromPartition`、`before-quit` 不覆盖 Windows 关机注销、Electron 安全建议、electron-builder NSIS 与工具链、builder v27 破坏性变更。

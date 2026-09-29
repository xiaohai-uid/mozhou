# 22 — OpenWrite 对标补齐：备忘录 + AI 起名（桌面端）

**What to build:** 对照 OpenWrite（openxz.cn v2.0.1，商业化对标调研见
`.scratch/openwrite-research-20260929/`）补齐墨舟缺失的两项自包含功能：

1. **备忘录**（OpenWrite 有 → 墨舟无）：与书无关的作者便签，跨作品常驻；
   POST /api/memo（list/create/update/delete）+ 桌面一级航道「备忘录」视图；
   按主体持久化于 `<dataRoot>/memo/<sha256(userId)>.json`。
2. **AI 起名**（墨舟已有本地摇号 LOCAL PRESET（`inspirationPresets`，零 AI），
   缺 AI 生成）：在灵感 Sheet（DesktopToolModals）追加 AI 起名区；
   POST /api/naming 走 BYOK 端点（resolveChatEndpoint），未配置模型时
   501 NAMING_NOT_CONFIGURED 诚实报错（真实性门禁同族，不伪造名称）。

**Blocked by:** —（两项均为自包含能力，不依赖支付/授权闭环）

**明确不做（本切片边界）：** OpenWrite 的应用内购买、应用内更新、局域网同步、
断线续写 UI——分别依赖商户/签名基础设施与发行链重做，见商业化调研报告第四节；
抽卡等价物（候选流 draft.candidate/accept）已在管线层存在，不重复建设。

**Status:** done（2026-09-30）

**契约（api-contract.md 第 27 节 · DELTA-006）：** /api/memo、/api/naming 新增，
策略均为 account（本地回退 local_user；hosted 按登录用户隔离）。

**涉及文件：**
- 后端：`server/memo/memoStore.ts`、`server/routes/memoRoutes.ts`、
  `server/routes/namingRoutes.ts`、`routePolicies.ts`（+2 策略）、`api.ts`（注册+类型导出）
- 前端：`src/memo/MemoView.tsx`、`src/shell/views.ts`（导航 +memo）、
  `src/App.tsx`（视图链）、`src/shell/DesktopToolModals.tsx`（AI 起名区）
- 测试：`memoRoutes.test.ts`（6）、`namingRoutes.test.ts`（5）、
  `MemoView.test.tsx`（4）、`DesktopToolModals.naming.test.tsx`（2）、
  `views.test.ts`（22→23 项更新）

**验收：**
- [x] 备忘录增删改查真实 HTTP + 磁盘回读全链路通过；损坏文件 500 诚实报错；超限 409
- [x] 多主体隔离（store 直测两 userId 文件互不可见）
- [x] AI 起名未配置模型 501；mock provider（MOZHOU_NAMING_PROVIDER）确定性样本；
      prompt/解析纯函数单测
- [x] views 注册表契约测试 23 项全唯一；typecheck 通过

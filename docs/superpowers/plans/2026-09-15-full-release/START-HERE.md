# 墨舟全功能收尾与双端发布：执行入口

> 给执行 AI：现在执行，不要只复述计划。采用本地 executing-plans，单写入者逐任务推进；用户已指定在 C:/zcode/novel-ai 工作，不必再询问采用哪种执行方式。本交接只创建指导文件和检查脚本，尚未实现其中的产品变更。

## 1. 用户已经确定的目标

- 完成墨舟主应用；公网可实际创作的网站 + Windows 本地应用，同一正式版本发布。
- 不做任何跨设备作品同步、WebDAV、多人协同。网站作品存服务器，Windows 作品存本机；账号、购买权益可共用，不等于同步小说。
- 其余现有可见功能全部收尾，含微信、支付宝真实付款；19 元/月与 39 元/月两档。
- 定价参照知识库 OpenWrite 的“功能会员 + 模型额度”双轨结构。不要复制竞品代码、密钥、发卡方式或“绝对不可破解”的断言。
- 优先大厂免费额度；没有授权自动购买服务器、升级付费套餐或代用户付款。

## 2. 必须依次读取

1. 当前仓库 AGENTS.md、CONTEXT.md；C:/zcode/.governance/SKILL-ROUTER.md。
2. 本目录 SPEC.md、CONTRACTS.md、tasks.json。
3. 01-core.md → 02-features.md → 03-public-billing.md → 04-release.md。
4. EXTERNAL-INPUTS.json（只记录非秘密状态；null 是真实缺少的外部输入，不允许编造）。
5. AUDIT.md 和 regressions/README.md：当前失败证据、复现边界及已通过的保护。

主规则在 WinClaw governance/AI-WORK-PROTOCOL.md。详细验收遵守 AGENT-OPERATIONS-PLAYBOOK.md §10。不要复活旧 V2/V3 控制平台。

任务文档路径缩写：server/ 固定为 apps/web/server/，src/ 固定为 apps/web/src/；packages/、scripts/、src-tauri/ 从仓库根解析。同一文件组内只写文件名时继承该组刚列出的目录。NEW 表示本任务待创建；先核对已有同职责实现，复用后登记最终文件。测试代码片段是验收断言目标，必须在所述测试文件中创建真实fixture和调用，不能直接粘贴未定义变量后声称可运行。

## 3. 立即执行的第一个操作

~~~powershell
Set-Location C:\zcode\novel-ai
node docs/superpowers/plans/2026-09-15-full-release/check-handoff.mjs
git status --short
git rev-parse HEAD
~~~

脚本只检查交接结构、依赖、文件定位；退出 0 不代表产品完成。然后执行 T00。

2026-09-15 审查时：master / fed29e32a86c47dc991da6883fe5d6cc2e4141fd，22 个已修改文件、未跟踪 evidence/release-fixes/。如果当前状态不同，记录差异并重新核对，绝不 checkout/reset/clean/stash 覆盖作者工作。

## 4. 每一项任务必须留下的记录

tasks.json 里只能使用 pending / in_progress / verified / blocked / failed。
每次只将一个任务设为 in_progress。结束时填写 evidence 数组与 result；不得一次把全部任务勾成 verified。

任务编号用于稳定引用，实际顺序以 tasks.json 为准。T05/T08/T09/T11/T13/T15 的平台验收使用真实 local/hosted 开发后端或桌面授权协议客户端；完整公网部署在 T16、干净 Windows 安装包在 T17 再验，不要求早期任务等待未来的安装包。T14 自行部署最小受限支付测试服务取得真回调，不等待 T16 完整网站。T02 的公式验收不等于 Max 可销售，最终额度由 T18 冻结。

每项 evidence 使用下面的形状，文件放 evidence/full-release/<run-id>/<task-id>/：

~~~json
{
  "kind": "test|http|browser|filesystem|real-provider|payment|install|hosted-ci",
  "path": "evidence/full-release/<run-id>/<task-id>/result.json",
  "sourceCommit": "<实际40位SHA>",
  "sourceFingerprint": "<T00定义的产品输入摘要>",
  "command": "<实际命令或用户操作>",
  "exitCode": 0,
  "scope": "<证明了什么>",
  "limitations": ["<没有证明什么>"]
}
~~~

这只是记录格式，不是可自填的发布令牌。日志原文、实际产物、源版本和独立复验必须一致。

每项固定步骤：

- [ ] 读任务目标文件；检查 upstream impact，记录直接调用者、跨模块链路、HIGH/CRITICAL 风险。
- [ ] 先运行该项失败复现；新增必要的最小失败测试，保存 red 日志。
- [ ] 实现任务定义的最小闭环；禁止为了绿灯删保护、删断言、改失败为跳过、把真实接口换成 mock。
- [ ] 运行该项回归和真实操作；保存 green/仍失败结果。
- [ ] diff 检查；刷新图谱后 check 与 detect_changes；只提交该项明确文件。
- [ ] 更新任务状态与下一步。一个原因连续失败两轮：保留证据，回到定位根因；不继续堆补丁。

## 5. 技能按任务使用

|任务|本地技能文件|用途|
|---|---|---|
|整体逐项执行|C:/Users/a1691/.agents/skills/executing-plans/SKILL.md|小步执行、状态更新|
|跨模块定位/修改|C:/Users/a1691/.agents/skills/gitnexus-exploring/SKILL.md；gitnexus-impact-analysis/SKILL.md|真实调用链和影响范围|
|T03–T07 缺陷|C:/Users/a1691/.agents/skills/systematic-debugging/SKILL.md|先证据后修复|
|UI 实际验收|C:/Users/a1691/.codex/plugins/cache/openai-bundled/computer-use/26.908.70816/skills/computer-use/SKILL.md|当前可用浏览器工具；版本路径失效则按当前技能目录找同名入口|
|发布验收|C:/Users/a1691/.agents/skills/verification-before-completion/SKILL.md|新鲜命令结果，禁止自报完成|

不要一次全文加载全部技能；本地未安装某插件不等于相应功能已存在。

## 6. 外部条件与停点

先完成不依赖外部条件的任务。缺商户审核、域名、服务器、真实模型凭据、邮件发送配置、代码签名或人工付款证据时：

1. 将对应任务设 blocked，列出具体缺项和已完成文件。
2. 继续依赖已满足的其他任务。
3. 最终状态必须是“代码已完成/外部验收未完成”等准确描述；禁止创建公开 Release、开放购买或把降级入口冒充实现。

不在聊天、源码、截图、日志里写密码、私钥、完整 token。EXTERNAL-INPUTS.json 只放 secret 的名称与 configured:true/false，不放值。

## 7. 发布纪律

T20 验收的是最终候选资产，T21 才做公开发布。之前不要建公开 tag 触发旧 release.yml，也不要手动上传旧包。
每次 push 必须走全局 git-push-gate.cmd，绑定实际 source commit、workflow、job。该入口不支持 tag 推送；T20 要改为受门禁分支 + workflow_dispatch 的发布通道，不能绕过 gate 用 raw tag push。
执行者不得自己签署独立安全审查。发布前由另一位审阅者或用户核对高风险证据，且目标 commit/资产哈希不变。

## 8. 提交给用户的最终结果

网站 HTTPS 地址、Windows 安装包下载地址、同版 commit/version/SHA256、两种支付的实际订单回执摘要、真实模型/长篇报告、安装升级恢复结果、遗留项（必须无阻断项）、回滚到上一版的方法。
“132 个测试文件全绿”不能代替以上结果。

# 当前完成情况与可核验基线

结论：应用尚不能按“全功能正式版”发布。以下是2026-09-15工作树审查；HEAD为fed29e32a86c47dc991da6883fe5d6cc2e4141fd，另有22个已修改tracked文件。不能只按这个HEAD复原全部审查输入。

## 已验证失败

1. **未采纳AI生成覆盖作者原文。** DialogueStream.tsx → /api/draft.stream → pipelineRoutes.ts → makeDraftProviderBinding → packages/pipeline/src/draft-step.ts 的 persistProse/atomicReplace。真实HTTP返回成功，但原文已被替换、revision仍为1、旧revision保存仍返回200；两段流之间的外部修改也丢失。根修复任务T03–T05。
2. 拆书、联网搜索、扫榜、备份、会员激活的当前HTTP入口分别返回501。诚实占位不等于真实功能，需T10–T15实现后删除旧假数据分支。
3. src-tauri/src/main.rs 当前没有拉起随包Node API后端的逻辑；仅加载静态前端不足以支持/api操作。T17需实际安装闭环。
4. apps/web/src/export-suite/docxExporter.ts 当前生成HTML；这不是正式DOCX文件。T10需有效OOXML与阅读器验证。
5. release-artifacts/mozhou-v0.1.1 是旧源码产物，缺当前部分路由；不能直接作为本次发布包。T20从最终源码重新构建。

## 已验证通过，但证明范围有限

- 原手动保存回归：外部修改409、双编辑器旧版本409、定稿保护409、显式重开及再次保存回读通过。
- 审查期间 workspace测试91文件/732用例通过；Web测试41文件/292通过，另1个真实模型测试跳过。workspace build、Web build、lint通过。
- GitNexus旧快照显示8866符号、19618关系、532流程，无循环；索引stale。三个覆盖链关键文件的索引hash与工作树一致，支持定位该调用链，不能代替最终全仓图谱刷新。

## 本交接脚本重新执行结果

交接脚本只更换临时测试书位置，没有改产品源码；使用本次审查已构建dist。流为合成输入，HTTP与文件系统是真实操作。

|脚本|实际退出码|含义|本机原始输出|
|---|---|---|---|
|regressions/verify-stream.mjs|1|原文覆盖阻断仍可复现|C:/Users/a1691/AppData/Local/Temp/mozhou-stream-regression-zUbL7h/result.json|
|regressions/verify-manual-save.mjs|0|手动保存保护仍通过|C:/Users/a1691/AppData/Local/Temp/mozhou-save-regression-9Beduq/result.json|
|check-handoff.mjs --self-test --check-targets|0|22任务依赖、现有目标文件与结构检查通过；四种坏记录被拒绝|重新运行命令可核验|

临时目录可能被系统清理，脚本可重新执行并生成新目录。基线结果不是未来源码验收凭据。

## 尚未验证

真实上游模型完整旅程、真实50章、公开网站多用户隔离、微信/支付宝收款与退款、Windows无开发工具安装/升级、最终发行资产与公网回滚。模型测试跳过、合成长篇测试和旧构建不能补足这些证据。

交接文件完成与产品完成是两件事；全部任务初始为pending，外部资源缺项如实登记在EXTERNAL-INPUTS.json。

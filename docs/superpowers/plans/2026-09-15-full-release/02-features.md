# 现有功能全部收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans task-by-task. 所有写操作复用前章安全边界。

**Goal:** 让所有承诺保留的入口都完成真实输入→真实产出→保存/回读。
**Architecture:** 在现有routes/views中补接真实能力，删除被truthful gate挡住的假数据；不换UI框架。
**Tech Stack:** 现有React/Vite、Node、packages、Vitest；文档归档确需依赖时才加入一个维护中的实现。
**Spec:** SPEC.md F01–F18；CONTRACTS.md C1/C5。

## T10 — 完整备份恢复 + 真TXT/DOCX/EPUB

**Modify:** apps/web/server/routes/systemRoutes.ts、worksRoutes.ts；src/export-suite/PublicationExportModal.tsx、docxExporter.ts、epubExporter.ts、txtCleanExporter.ts；src/cloud-sync/CloudSyncView.tsx；src/shell/views.ts。
**Create:** packages/data-plane/src/book-backup.ts、book-backup.test.ts；apps/web/server/routes/backupRoutes.ts、backupRoutes.test.ts。
**Consumes:** T04书写保护；T09归属边界。**Produces:** backup/export/read/recover同一归属保护、C5归档。

- [ ] 将云同步导航替换为“备份与迁移”，删除WebDAV/上传下载同步状态和team-sync宣传；原用户数据不删。
- [ ] 在书锁下生成一致快照，清晰区分可重建投影和不可丢失ledger/candidates/proposals。不得把整个.mozhou当缓存扔掉。
- [ ] NEW POST /api/backups {bookId} → {backupId,bytes,sha256}；GET /api/backups/<id>/download必须再次鉴权；NEW POST /api/backups/restore上传归档→新bookId。禁止传任意destination路径。
- [ ] 归档还原严格执行C5：限制最多10000文件、单包解压1GiB、单文件100MiB；超限给明确错误，不能截断。输入预算若不支持目标数据集须先说明并修改合同，不删测试。
- [ ] 恢复为新书目录→hash全部匹配→重建投影→回读正文/分镜/风格/提案/候选→登记成功。失败不留下半书，旧书hash全保持。
- [ ] 修DOCX：目前docxExporter.ts生成HTML；正式.docx必须为OOXML ZIP，含[Content_Types].xml、_rels/.rels、word/document.xml。HTML只能叫.html，不能改扩展名骗人。
- [ ] EPUB必须是有效EPUB3 ZIP（首项mimetype、META-INF/container.xml、OPF/nav/XHTML、正确转义），不是一组XML或JSON。TXT尊重章顺序/Unicode，不混提示词/内部hash。
- [ ] 若现有依赖无归档能力：单选经官方文档核对、许可证合规的ZIP库；DOCX单选成熟库。加依赖只落目标workspace并锁版本，不把整个Office工具链装入应用。

~~~ts
// 新增到 book-backup.test.ts/backupRoutes.test.ts 的实际断言目标
expect(restoredCanonDigest).toBe(sourceCanonDigest);
expect(oldBookDigestAfterFailedRestore).toBe(oldBookDigestBefore);
expect(responseForOtherUserDownload.status).toBe(404);
expect(restoredCredentialsFound).toBe(false);
// 对 ../escape、/absolute、symlink、重复path、ZIP bomb、坏hash逐个expect拒绝。
~~~

**Commands:** pnpm exec vitest run packages/data-plane/src/book-backup.test.ts；pnpm --filter @mozhou/web test -- server/routes/backupRoutes.test.ts
**Real pass:** 实际打开导出的Word/WPS、EPUB阅读器和TXT，章节/段落/中文都正确；把备份在另一临时根恢复并重启打开。
**Evidence:** 归档+sha256+结构检查+阅读器截图+逐文件恢复摘要，不能只有浏览器下载成功。
**Rollback:** 保留上一归档格式读取器只限已发布数据迁移；不能覆盖恢复原目录，失败仅清本次临时新目录。

## T11 — 真书源、检索、扫榜和可追溯引用

**Modify:** apps/web/server/routes/crawlerRoutes.ts、truthfulPreviewRoutes.ts；server/crawlers/{provider-utils,crawl4ai,multisource,qidian,qimao,rankings}.ts；src/{book-source,shelf,rank-scan,web-search}。
**Create:** server/search/provider.ts、server/search/provider.test.ts、server/routes/researchRoutes.test.ts。
**Consumes:** T07共享网络边界、T09身份；**Produces:** C5真实来源结果，检索sourceId可被引用。

- [ ] 用已有searchMultipleSources、fetchQidianHotBoard等函数做最小真请求，记录页面来源/解析结果，不先删501保护。
- [ ] 从rankings.ts删除“知名作家/前沿主线设定/当前霸榜力作”等伪造补值。源缺字段就null/未知；排名与抓取日期来自真实源，历史缓存标stale。
- [ ] 网页搜索接一个合法可商用、已配置的搜索API；搜索服务商需T01记录。客户端不传URL去任意内网，不在代码里写免费端点假设。搜索无结果就空数组，不补ALL_KNOWLEDGE。
- [ ] 输入schema：query trim后1–200字符；URL只http/https且通过DNS/每跳/私网保护；请求体、响应体、timeout、并发/速率有界。crawl4ai不存在时只用已实现且安全的HTTP解析，不自动安装服务。
- [ ] 每个引用存title/url/sourceHash/fetchedAt/quoteRange；模型总结与引文分开。页面变动标来源stale，引用不伪造“官网说”。
- [ ] 书架保存引用和已授权导入的文本，重启回读；不要爬绕付费/验证码/登录限制，不把失败变成假正文。
- [ ] 真接口+UI通过后删除对应truthfulPreviewRoutes分支与旧样例实现，注册顺序无死路；保留无配置/限流/源失效错误。

~~~ts
expect(result.items.every(x => x.sourceUrl.startsWith('https://'))).toBe(true);
expect(result.items.every(x => !Number.isNaN(Date.parse(x.fetchedAt)))).toBe(true);
expect(failedSourceResult.items).toEqual([]); // 若有旧缓存则必须stale:true
expect(metadataNetworkRequestCount).toBe(0);
~~~

**Commands:** pnpm --filter @mozhou/web test -- server/search/provider.test.ts server/routes/researchRoutes.test.ts
**Real pass:** 至少一个真书源、一条真实联网检索、一个真实榜单能在local/hosted模式的开发浏览器中展示并打开来源；安装版复验归T17；源宕机、429、重定向到内网均正确失败。无服务配置=blocked，不是实现失败可忽略。
**Rollback:** 保留501诚实降级直到真实链路完成；不恢复假数据。

## T12 — 拆书、文风、类型素材、技能配方

**Modify:** apps/web/server/routes/systemRoutes.ts、truthfulPreviewRoutes.ts；src/{novel-breakdown,style-distill,genre-kits,capability-square}；packages/quality-engine/src/style相关现有函数。
**Create:** server/analysis/novelBreakdown.ts、novelBreakdown.test.ts；server/analysis/styleAnalysis.ts、styleAnalysis.test.ts；server/skills/catalog.ts、catalog.test.ts。
**Consumes:** T07真实LLM、T09书归属、T15权益（开发期用测试账户，不绕过生产门禁）。**Produces:** 原文锚定的分析/可应用style profile与受控技能目录。

- [ ] 小说拆解按上传/选中的真实文本生成结构化人物、冲突、节奏、章钩子；逐项引用原文span/sourceHash。删除现有“样本文本主角”和固定剧情模板。
- [ ] 依据分镜已有运行时校验模式校验LLM JSON；身份/路径/版本由服务端重铸；引用必须在原文存在，抽象建议明确是分析。恶意样本中的“删文件/忽略规则”不能执行。
- [ ] 风格蒸馏现有evaluateStyleMetrics仍提供机械指标，但另需真实style profile建议与样例依据；确认后版本化保存到该书，下一次生成receipt记录应用版本。
- [ ] 批量/长样本切片：固定最大输入长度、分块边界、归并schema及最多2次修复；支持取消和部分报告，不能因截断而宣布全书分析完成。
- [ ] 类型模板/人物设定/素材选择真正进入保存的大纲或context receipt；静态内置模板应标“内置模板”，不冒充模型刚生成。
- [ ] 技能广场范围：审核后的提示词配方浏览/搜索/启停/应用+用户本地自建；新增/更新schema包含id/version/license/source/requiredCapabilities。不能只显示详情却无法应用。
- [ ] 下载/导入只允许数据配方，禁止shell/Python/任意JS与模型授予文件权限；市场条目缺许可证不分发。当前账户等级在服务端判断，客户端隐藏按钮只是体验。
- [ ] 来源上传、style/recipe保存、删除只影响该用户该书，任务在中途切书后仍绑定原目标。

~~~ts
expect(report.items.every(x => source.slice(x.span.start,x.span.end) === x.quote)).toBe(true);
expect(modelRequestedFileWrite).toBe(false);
expect(nextReceipt.appliedStyleVersion).toBe(confirmedStyle.version);
expect(nextReceipt.appliedRecipeVersion).toBe(enabledRecipe.version);
~~~

**Commands:** pnpm --filter @mozhou/web test -- server/analysis server/skills
**Real pass:** 一份真实授权样本→真模型报告→作者确认style/recipe→下一次生成receipt/正文可见效果；不能只证明JSON符合schema。
**Rollback:** style/recipe追加版本，切回旧版本；删除分析不回删原文。

## T13 — 分镜、任务中心、检视和所有导航收口

**Modify:** server/storyboard/{contract,generate,store}.ts、routes/storyboardRoutes.ts；src/storyboard/StoryboardView.tsx；src/{story-brain,context-receipt,change-matrix,tasks,works}；apps/web/src/shell/views.ts、apps/web/src/shell/PipelineStrip.tsx、apps/web/src/shell/CapabilityChannels.tsx。
**Create:** server/routes/fullJourney.test.ts；scripts/release/navigation-acceptance.mjs。
**Consumes:** T05/T06/T10/T11/T12/T09；**Produces:** SPEC功能列表逐项真实可用。

- [ ] 保留分镜已有“候选不落盘→显式保存”模式；共享T07取消/usage，但不让正文生成再次直接写正文。
- [ ] 分镜保存绑定源hash+文档revision，切书/离开dirty/刷新缓存/源修改stale全部验收；重建投影/备份恢复不得丢分镜。
- [ ] 真实模型分镜检查场景/人物/对白归属、时长总和、原文引用、改编标注；保存后关进程再打开，导出可被下游阅读/使用。
- [ ] 任务中心来自真实任务/账本，显示每项当前状态/取消/恢复/失败；不得常量0徽标、随机进度、只列内存任务。
- [ ] Story Brain真实反映confirm/reject后事实；Receipt能重算且说明删减；Change Matrix更改上游后标stale，并只重跑明确选择的任务，不重写保护正文。
- [ ] 对照SPEC F01–F18逐项列按钮→HTTP→领域函数→文件/事件→回读证据；导航全部有empty/loading/success/error状态。替换云同步后逐个测新旧深链接，不把17/18项历史计数当验收。
- [ ] UI保持已批准银白设计；不重做主题。解决中文输入、键盘焦点、对比度、长标题溢出、移动浏览器付款/回跳和表单错误。
- [ ] 所有购买/免费限制说明从catalog读取；没有实现的“无限、自动发布、自动出片”宣传删除。用户作品访问不得被会员到期锁死。
- [ ] F16由本任务负责：复用现有路由，新建 apps/web/src/public/PublicSite.tsx 及测试，提供未登录可访问的产品说明、定价、Windows下载、使用帮助、服务条款、隐私与退款说明；接到现有App路由，不另造前端工程。列真实运营主体/联系方式、数据位置、模型调用会发送哪些内容、删除/导出方法；缺真实主体信息登记外部缺项，不填虚构公司。下载链接来自T20生成的release manifest，未发布时显示尚未发布，不指向旧包；T21换成最终公开资产后从外网点击验收。静态页面不得包含secret或被强制登录拦住。

~~~ts
expect(taskAfterRestart.id).toBe(taskBeforeRestart.id);
expect(taskAfterCancel.state).toBe('cancelled');
expect(staleStoryboard.sourceStale).toBe(true);
expect(protectedChapterAfterRerun).toBe(protectedChapterBeforeRerun);
~~~

**Commands:** pnpm --filter @mozhou/web test；NEW navigation-acceptance脚本对实际服务器逐项采集，不测试内置mock页面。
**Real pass:** 本任务在开发服务器local/hosted两种模式分别走完整导航旅程；公网部署复验归T16，Windows安装版复验归T17，至少保留关键路径视频/截图+对应HTTP和落盘记录；看不见的后台结果必须回读核实。
**Rollback:** 单功能切回前一可用实现，保留生成/保存数据；不能靠永久隐藏失败功能完成T13。


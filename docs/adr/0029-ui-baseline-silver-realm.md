# ADR-0029 · 银白创作空间（superseding ADR-0028 视觉层）

日期：2026-09-14 · 状态：已实施（生产构建） · 来源：用户签样 silver-space 设计候选 + ui-ux-review U01–U09

## 决定

生产视觉从 Ink Realm 深墨主题切换为 **Silver Realm 银白创作空间**：

1. **同名换值**（ADR-0028 机制延续）：`globals.css :root` 全量换银白色阶
   （canvas #e6ecf2 / panel #f1f4f7 / text #202a35 / 香槟金 #ac803f→#f5e5c9）；
   语义不变：Gold=作者主权 · Steel(原 Jade)=AI·系统 · Green=verified · Warning=stale · Red=blocking。
   `--gold-bright` 取深香槟 #8a6a2f 保浅底文字对比度。
2. **材质**：token 换值 + ink-orbit/ink-realm 硬编码深底逐处换浅
   （topbar/sidebar/center/chapterbar/reading-slate/scene-glass/scene-atmosphere/scene-veil）；
   场景剪影带（`.scene-layer::after`）对 `silver-atrium` 隐藏。
3. **默认场景**：新增内置 `silver-atrium`（`public/scenes/silver-atrium.svg`，原创银白空间资产），
   `DEFAULT_SCENE_PROFILE` 默认之（veil 0.12、人物层默认关）；场景上传/人物显隐/作品作用域全部保留。
4. **导航重组（U01）**：主任务四域一级直达（作品/写作/分镜/素材）+「工具箱」折叠收纳其余 14 航道——
   18 项全部可达，不把隐藏当删除。
5. **分镜独立任务面**：分镜页不挂 PipelineStrip/检视塔（`app-storyboard` 布局变体）。
6. **分镜交互（U04/U05）**：默认工作视图=场景分组镜头序列+单镜主区编辑+原文/提示词/改编说明详情标签；
   卡片视图保留为收藏式切换；手机为全屏任务页（固定顶栏+底部安全区工具栏），不再用抽屉承载。
7. **离开保护（U06）**：`dirtyGuard` 共享脏状态贯穿外壳——切页/切书/关抽屉确认、beforeunload；
   未保存候选同样受保护；干净文档不拦。
8. **字阶（U07）**：UI 14.5px / 正文 18px 衬线 / 状态 12–13px；id/hash 收进「文档详情」折叠。

## 后果

- 旧深墨视觉由 git 历史保留（本 ADR supersede，不改写 ADR-0028 文本）。
- 消费方零改动承诺兑现：换值后全站组件无结构性 TS 改动。
- 已知打磨项（非阻断）：顶栏书名/「本地已就绪」等水印式标题可加深一档；
  长动作摘要在输入框内的水平空间可优化；真机模型生成验收仍 BLOCKED（无 key）。

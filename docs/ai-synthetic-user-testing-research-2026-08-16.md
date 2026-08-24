# AI 模拟真实用户测试项目调研

日期：2026-08-16

## 结论

没有一个成熟开源项目同时解决“真实浏览器操作、情绪状态、用户路径偏差、等待耐心和商业化评估”。目前最可行的组合是：

1. 用真实浏览器驱动层执行点击、输入、滚动、返回、刷新和移动端手势。
2. 用 Persona、目标、约束、时间压力和情绪状态机决定用户下一步动作。
3. 用独立评估器记录成功/失败、首个反馈耗时、重复操作、死路、放弃和主观摩擦。
4. 用少量真实用户结果校准模拟用户，而不是把 LLM 的一句“我很沮丧”当成人类证据。

## 项目快照

星标和代码推送时间来自 GitHub Repository API，快照时间为 2026-08-16。判断维护活跃度时以 `pushed_at` 为主，`updated_at` 只作辅助，因为后者也可能被 issue、PR 或仓库元数据更新触发。

| 项目 | 星标 | 最近代码推送 | 适合解决什么 | 主要限制 |
|---|---:|---|---|---|
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | 109,370 | 2026-08-15 | AI 浏览器执行层、长任务、QA 和可嵌入产品 | 本身不是情绪/用户研究评估器；Python 为主 |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | 40,690 | 2026-08-15 | 跨平台浏览器 CLI、持续会话、真实点击/输入/截图 | 需要自行补 Persona、情绪和评估层 |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 36,170 | 2026-08-12 | 可访问性树驱动的结构化浏览器操作，适合稳定回归 | 操作偏确定性，不模拟人的犹豫、误解和情绪 |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | 23,950 | 2026-08-16 | TypeScript 生产级浏览器 Agent，AI 与 Playwright 混合、自修复、可观测 | 仍需自己实现用户画像、情绪和评分 |
| [xlang-ai/OSWorld](https://github.com/xlang-ai/OSWorld) | 3,082 | 2026-08-12 | 真实电脑环境中的多模态 GUI 任务和桌面级操作 | 重量大，超出普通网站验证的第一阶段范围 |
| [ServiceNow/BrowserGym](https://github.com/ServiceNow/BrowserGym) | 1,317 | 2026-07-17 | WebArena、WorkArena、VisualWebArena 等可扩展任务基准 | 官方明确说明它是研究框架，不是消费产品 |
| [TIGER-AI-Lab/ClawBench](https://github.com/TIGER-AI-Lab/ClawBench) | 566 | 2026-08-15 | 153 个日常任务、144 个网站、隔离容器、五层轨迹和人类参考评估 | 更像评测基准，不是直接嵌入墨舟的 SDK |
| [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench)（当前为 τ³-bench） | 1,798 | 2026-08-14 | 用户模拟器、Persona、多轮交互、语音/多模态和动态工具使用，最适合借鉴“用户心智” | 不是浏览器测试框架，需要和浏览器执行层组合 |
| [ServiceNow/AgentLab](https://github.com/ServiceNow/AgentLab) | 622 | 2026-07-17 | 基于 BrowserGym 的批量实验、可复现运行、排行榜 | 研究基础设施，部署和学习成本高 |
| [awizemann/harness](https://github.com/awizemann/harness) | 321 | 2026-07-21 | 最贴近“真实用户”：Persona、目标、截图点击滚动、成功/失败/阻塞、路径回放和时间戳摩擦 | macOS 原生工具，alpha，不能直接作为墨舟的 Windows/云端核心依赖 |
| [ServiceNow/webarena-verified](https://github.com/ServiceNow/webarena-verified) | 51 | 2026-03-08 | 版本化任务、确定性评估器、网络轨迹回放，适合商业发布前做离线回归 | 星标和更新活跃度偏低，但验证思路很有价值 |
| [web-arena-x/webarena-infinity](https://github.com/web-arena-x/webarena-infinity) | 67 | 2026-03-24 | 可验证任务和更真实的浏览器环境生成 | 仍偏研究项目，社区规模较小 |
| [web-arena-x/webarena](https://github.com/web-arena-x/webarena) | 1,579 | 2025-11-26 | 真实感较强的多站点 Web 环境和任务集合 | 代码推送较旧，不适合作为第一选择的活跃底座 |

## 与你的问题最相关的项目

### 1. Harness：最像你要的“真人测试员”

它不是只检查按钮是否能点，而是给 Agent 一个目标和 Persona，让它读取界面、点击、输入、滚动，并记录“成功/失败/阻塞”、可回放路径以及带时间戳的摩擦事件。它还明确区分了首次用户、认证受阻、无响应控件等情况。

墨舟不应该直接引入它，而应该借鉴它的结果模型：`persona + goal + step trace + friction event + abandon reason`。

### 2. ClawBench：最适合借鉴“操作偏漏”和可复现评估

它覆盖预订、点餐、求职、邮件和项目管理等日常任务，在隔离浏览器中记录动作、请求、截图、视频和评估结果，还支持先跑人类参考轨迹，再比较 Agent 结果。这比“让 Agent 看一眼首页然后给分”接近真实测试。

墨舟可以把它的任务格式改成：首次创作、等待生成、修改要求、取消生成、切换作品、返回重试、移动端操作和失败恢复。

### 3. τ³-bench：最接近“用户心智和情绪”的可借鉴来源

τ³-bench 的重点不是让 Agent 点网页，而是让 Agent、工具和用户模拟器进行多轮交互。它支持单独配置 user LLM、Persona、知识检索、语音和多模态等方向，因此比单纯给浏览器 Agent 加一句“你现在很焦虑”更接近可重复的用户模型。

它不能直接解决墨舟的网页点击问题，但可以借鉴其 user simulator 设计：用户有自己的目标、知识边界、工具权限、记忆和下一步反应，情绪变化应由交互结果触发，而不是每一步由模型自由发挥。

### 4. Stagehand / Browser Use / agent-browser：浏览器执行底座

Stagehand 最适合当前墨舟的 TypeScript/Next.js 生态，因为它把自然语言动作与 Playwright 风格的确定性代码结合，并强调自修复、速度、可靠性和可观测性。Browser Use 的社区最大，且官方提供了真实浏览器任务基准和可嵌入产品的 Python 库。agent-browser 则更像跨平台 CLI，支持 Windows x64、持续浏览器会话和截图/操作命令。

它们都不能自动生成“真实情绪”。情绪必须由墨舟自己定义为状态机和触发规则。

### 5. BrowserGym / AgentLab / WebArena-Verified / OSWorld：规模化评估底座

BrowserGym 和 AgentLab 适合建立任务集、跑多模型、多种子和排行榜；WebArena-Verified 的确定性评估器与网络轨迹回放适合做商业发布前的离线回归；OSWorld 更适合以后验证桌面级操作。它们能解决“不能只测一个 happy path”，但不应被误认为已经解决了商业产品的用户体验判断。

## 对墨舟的推荐路线

第一阶段不接入完整研究框架，先做一个墨舟专用的 `Synthetic User Runner`：

- 执行层：优先评估 Stagehand；如果更看重社区和现成 Agent，评估 Browser Use；如果希望轻量跨平台 CLI，评估 agent-browser。
- 用户层：每次运行绑定一个 Persona，例如“第一次写小说、时间紧、对 AI 不熟”“熟悉 AI、对等待极敏感”“移动端用户、只看首屏”。
- 情绪层：使用 `calm → uncertain → impatient → frustrated → distrustful → abandon` 状态机。状态转换由无反馈时长、重复点击、错误文案、页面跳转、空结果和等待超时触发。
- 操作层：强制允许真实用户式动作，包括先读首屏、滚动、误点、退回、刷新、重复提交、切换标签、停留观察和放弃，不允许 Agent 直接读取后端状态来判断成功。
- 评估层：单独记录 `time_to_first_feedback`、`time_to_first_useful_output`、无反馈窗口、重复动作、回退次数、死路、取消、放弃、信任下降和最终任务结果。
- 校准层：先用 5 至 10 个真人跑同一批任务，比较真人与模拟用户的等待阈值、放弃率、困惑点和反馈措辞，再调整情绪状态机。

学术上，UXAgent 的方向也验证了这个拆法：Persona Generator、LLM Agent 和 Universal Browser Connector 分开，目标是批量模拟用户做可用性测试；但它更适合作为方法参考，不能替代真人研究。

## Sources

- [Harness README](https://github.com/awizemann/harness)
- [ClawBench README](https://github.com/TIGER-AI-Lab/ClawBench)
- [τ³-bench README](https://github.com/sierra-research/tau2-bench)
- [Stagehand README](https://github.com/browserbase/stagehand)
- [Browser Use README](https://github.com/browser-use/browser-use)
- [Playwright MCP README](https://github.com/microsoft/playwright-mcp)
- [agent-browser README](https://github.com/vercel-labs/agent-browser)
- [BrowserGym README](https://github.com/ServiceNow/BrowserGym)
- [AgentLab README](https://github.com/ServiceNow/AgentLab)
- [WebArena-Verified README](https://github.com/ServiceNow/webarena-verified)
- [WebArena-Infinity README](https://github.com/web-arena-x/webarena-infinity)
- [OSWorld README](https://github.com/xlang-ai/OSWorld)
- [WebArena README](https://github.com/web-arena-x/webarena)
- [UXAgent paper](https://arxiv.org/abs/2502.12561)
- [GitHub Repository API: Harness](https://api.github.com/repos/awizemann/harness)
- [GitHub Repository API: Browser Use](https://api.github.com/repos/browser-use/browser-use)
- [GitHub Repository API: Stagehand](https://api.github.com/repos/browserbase/stagehand)
- [GitHub Repository API: Playwright MCP](https://api.github.com/repos/microsoft/playwright-mcp)
- [GitHub Repository API: agent-browser](https://api.github.com/repos/vercel-labs/agent-browser)
- [GitHub Repository API: ClawBench](https://api.github.com/repos/TIGER-AI-Lab/ClawBench)
- [GitHub Repository API: τ³-bench](https://api.github.com/repos/sierra-research/tau2-bench)
- [GitHub Repository API: OSWorld](https://api.github.com/repos/xlang-ai/OSWorld)
- [GitHub Repository API: BrowserGym](https://api.github.com/repos/ServiceNow/BrowserGym)
- [GitHub Repository API: AgentLab](https://api.github.com/repos/ServiceNow/AgentLab)
- [GitHub Repository API: WebArena-Verified](https://api.github.com/repos/ServiceNow/webarena-verified)
- [GitHub Repository API: WebArena-Infinity](https://api.github.com/repos/web-arena-x/webarena-infinity)
- [GitHub Repository API: WebArena](https://api.github.com/repos/web-arena-x/webarena)

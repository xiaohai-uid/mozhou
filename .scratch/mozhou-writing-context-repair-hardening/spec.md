# 墨舟写作上下文 Hardening Spec

日期：2026-08-13  
状态：Grill 已批准；测试 seam 已批准；可进入 to-tickets/implement 前的人工 Gate
基线：`0536fa9`（候选生命周期引入前）  
产品：墨舟（MoZhou）中文小说写作平台

## Problem Statement

墨舟已经上线，独立写作对话和章节写作对话都能完成页面交互与模型调用，但此前的上下文修复提交存在四个交付风险：

1. 生产环境只要设置 `CHAT_PROVIDER=mock` 就可能实际使用模拟模型；
2. 业务层 `PreparedChatRequest` 被测试捕获的 messages 与 one-api 实际发送的 messages 不是同一份数组，因为 transport 会额外前置 system message；
3. payload observer 把调用方传入的 current-user 索引当作权威事实，错误索引可能产生错误诊断；
4. 候选生命周期代码与 schema/migration 不在同一提交边界，导致当前 HEAD 不能作为干净、独立的候选交付物。

用户需要的是：无论独立对话还是章节对话，模型都能收到正确的写作身份、模式约束、已验证作品上下文、有效历史和本轮请求；系统又能证明最终 provider payload，而不泄露正文或提示词；生产配置错误不能把用户请求送入模拟模型。

本 Spec 只针对写作上下文和模型输入 hardening。候选生命周期是独立领域，不在本 Spec 中实现。

## Solution

在候选生命周期引入前的 `0536fa9` 基线之上，完成一条可独立构建和验证的写作上下文 hardening 交付链：

1. 保留统一写作上下文构造：所有写作请求都具备 Base Identity 和对应 Mode Contract；system 表达模型应遵守的身份、模式和参考，messages 表达可重放历史与作者本轮请求。
2. 保留两个明确的测试边界：
   - 语义 payload seam：`PreparedChatRequest`，描述 system、历史 messages、本轮 user 和脱敏 scope metadata；
   - wire payload seam：transport 根据语义请求生成 provider 实际消费的完整 payload，包含 system message、语义 messages、model 和 stream 选项。
3. completion 与 streaming 使用同一个 wire payload 转换规则；fake transport 读取的对象必须就是实际发送给 one-api 的对象。
4. current user 的权威来源是统一上下文构造的最终消息位置；observer 不信任 consumer 传入的 indices，不用全局 content 相等去重，也不记录内容。
5. 生产环境检测到 Mock provider 配置时，请求级 fail closed：不启动 Mock，不静默切换 one-api，只向客户端返回既有通用错误。
6. 共享 SSE framing 只负责编码、取消、终止和安全错误；独立对话与章节对话继续保留各自的领域事件和外部语义。
7. 交付分支以 `0536fa9` 为基线，在独立 worktree 中整理；当前 `main` 的用户未提交改动不属于本 Spec 的修改范围。

## User Stories

1. 作为中文网文作者，我希望每次独立写作对话都知道自己在和墨舟小说写作助手交流，从而没有参考资料时也不会退化成普通聊天机器人。
2. 作为中文网文作者，我希望章节写作对话明确知道自己处于章节模式，从而章节参考不会被误当作普通聊天历史。
3. 作为作者，我希望独立对话遵循我的本轮请求，而不是因为存在风格、技能或 RAG 就自动生成正文。
4. 作为作者，我希望章节对话先理解本轮请求；我要求讨论或分析时，不会因为存在章节技能就强行续写。
5. 作为作者，我希望明确要求起笔、续写、改写或润色时，模型能同时遵守已验证的作品、章节、风格和技能约束。
6. 作为作者，我希望本轮请求始终作为最后一条 user message 发送，从而模型能正确理解当前意图。
7. 作为作者，我希望本轮请求只进入模型一次，从而不会因消息落库、历史读取或拼接逻辑重复执行任务。
8. 作为作者，我希望两轮内容相同但身份不同的历史消息仍被分别保留，从而相同文字不会被错误去重。
9. 作为作者，我希望短对话发送完整有效历史和本轮请求，不因无必要压缩丢失上下文。
10. 作为作者，我希望长对话只发送摘要、近期保留历史和本轮请求，不重复发送已被摘要的早期消息。
11. 作为作者，我希望本轮请求不参与本轮历史压缩，从而最新意图不会被摘要替代。
12. 作为作者，我希望压缩服务失败时写作请求仍能继续，并安全地回退到完整有效历史。
13. 作为作者，我希望章节正文参考和章节对话历史分开，从而正文不会被计算成聊天历史。
14. 作为作者，我希望只有通过既有选区合法性校验的选区才会进入上下文，从而伪造或越界片段不会影响模型。
15. 作为作者，我希望未绑定作品的独立会话不读取其他作品的设定，从而不同作品不会发生上下文串用。
16. 作为作者，我希望已绑定会话始终使用服务端确认的作品归属，从而客户端不能临时切换模型上下文。
17. 作为作者，我希望章节上下文由章节所属作品和当前用户关系决定，从而客户端不能拼接其他作品的章节。
18. 作为作者，我希望归属失败在模型调用前终止，从而错误请求不会产生跨范围的模型输入。
19. 作为测试维护者，我希望能读取独立对话最终生成的语义 payload，从而验证身份、模式、历史和当前 user。
20. 作为测试维护者，我希望能读取章节对话最终生成的语义 payload，从而验证章节历史和正文参考分层。
21. 作为测试维护者，我希望 fake provider 读取 one-api 实际会收到的 wire payload，从而测试不会把中间对象误当最终 HTTP body。
22. 作为测试维护者，我希望 completion 和 streaming 使用同一 payload 转换规则，从而摘要请求和正文请求不会发生结构漂移。
23. 作为运维人员，我希望 observer 只记录消息角色、数量、区段和归属状态，从而能诊断上下文问题但不泄露正文、prompt、token 或凭据。
24. 作为运维人员，我希望 observer 即使失败也不影响模型请求和 SSE 语义，从而诊断能力不会成为写作故障。
25. 作为运维人员，我希望 payload observation 带固定 schema version，从而不同版本的脱敏数据可以比较。
26. 作为发布负责人，我希望生产环境误配 Mock 时当前请求明确失败，而不是返回模拟内容或静默改走其他 provider。
27. 作为发布负责人，我希望本 hardening 分支能从干净基线独立构建、测试和检查，从而不会依赖候选生命周期的未提交 schema。
28. 作为开发者，我希望共享 SSE 模块只管理传输生命周期，从而章节候选和独立会话语义不会被错误耦合。

## Implementation Decisions

### 1. 交付边界

本 Spec 以 `0536fa9` 为整理基线，在独立 worktree 中实施。当前 `main` 分支和其已有未提交改动不修改。候选生命周期相关提交不通过手工删除混入本 effort；候选领域另建 Spec/Contract Delta。

### 2. 语义 payload

统一上下文构造模块继续输出 `PreparedChatRequest` 语义对象，至少包含 model、可选 system、历史 messages、本轮 user 和脱敏 observation scope。两个 consumer 都必须通过同一构造规则。

system 区段顺序固定为：Base Identity、Mode Contract、已验证作品上下文、章节参考、合法选区、Style、Skill、Compression Summary。没有内容的区段不生成空壳区段。

messages 只包含可重放的 user/assistant 事实和本轮 user；历史按时间顺序排列，本轮 user 最后一条且恰好追加一次。system/context 不转成 user message；章节正文参考不进入 ConversationHistory；本轮请求不参与压缩。

### 3. wire payload

transport 模块拥有唯一的 provider payload 转换规则。它将语义请求转换为 provider wire payload：如果存在 system，就在 messages 前置一个 system role，再接语义 messages；model、stream 和可选温度等传输参数由 transport 统一管理。

completion 和 streaming 必须调用同一转换逻辑。fake transport 或 capturing adapter 捕获的对象必须来自该转换点，而不是从 route、service 或 context builder 复制一份近似对象。

### 4. current user 事实

统一上下文构造负责将本轮 user 追加到语义 messages 末尾。observer 不把 caller-provided currentUserIndices 当权威来源，不使用全局内容相等去重。

observer 只从最终结构派生脱敏事实：语义 messages 的最后一条必须是 user；wire messages 去除前置 system 后的最后一条必须是 user。`current_user_present` 只表示该结构不变量满足；`current_user_occurrences` 只记录结构上最后一条 user 是否存在，合法值为 0 或 1。重复或缺失的本轮身份由语义 seam 测试和 payload contract 校验发现，不记录内容。

### 5. 生产 Mock 配置

transport composition root 在 `NODE_ENV=production` 且 `CHAT_PROVIDER=mock` 时抛出配置错误。错误发生在当前模型请求进入 provider 前；上层沿用安全错误归一化，客户端不获得环境变量、内部错误或 transport 细节。测试环境可以显式使用 Mock，生产不得静默使用 Mock，也不得因为配置错误自动切换 one-api。

### 6. Observer

生产 observer 只允许记录白名单结构字段：request id、route、mode、model、payload schema version、system 是否存在、system sections、system 字符数、message count、message roles、history counts、current-user 结构事实、compression、RAG/style/skill flags 和 ownership flags。

禁止记录完整 system、完整 messages、正文、选区、RAG 内容、Style/Skill 文案、摘要正文、认证信息、token、cookie 和数据库 URL。observer 写入失败必须 fail-open。

### 7. SSE

共享 SSE 模块只负责 SSE 编码、request abort 传播、终止事件单发、stream close-once 和安全错误。独立 chat 与 chapter chat 的 start/delta/done/error 字段、领域错误码和业务完成判断由各自 route/domain 保留。

### 8. Schema 与外部契约

本 Spec 不新增数据库表、字段或 migration，不改变对外 chat/chapter chat 请求字段，不改变既有 SSE 领域事件和章节消息状态语义。任何候选生命周期字段或行为必须进入后续独立 Contract Delta。

## Testing Decisions

### 测试原则

测试必须验证外部可观察行为和 provider 消费边界，不只验证 private helper、system 字符串片段或固定 Mock 输出。每个工单先写能在当前基线变红的测试，再实现最小修复。

### 测试 seam

本 Spec 固定两个 seam：

1. 语义 seam：读取真实独立/章节 consumer 生成的 `PreparedChatRequest`，断言 system、messages、scope 和压缩结果。
2. wire seam：读取 transport 生成的 provider wire payload，断言 one-api 实际 body 的 messages 顺序、role、system envelope、model 和 stream 选项。

两个 seam 必须由同一 consumer 链路驱动，不能用孤立 helper 替代真实 consumer。

### 必须覆盖的行为

1. 独立无作品、无风格、无技能请求仍包含 Base Identity 和 independent Mode Contract。
2. 独立有参考资料时，讨论请求仍保留本轮 user 意图，不被资料转换为正文生成。
3. 章节请求包含章节历史和本轮 user，正文参考位于 system 的独立区段。
4. 短历史不生成空摘要；长历史只发送可用摘要、近期历史和本轮 user。
5. 内容相同但 role/identity 不同的历史消息不被错误去重。
6. 本轮 user 不参与压缩，且语义 messages 最后一条始终为 user。
7. 合法选区进入 selection 区段，非法选区不进入 system 或 messages。
8. 未绑定独立会话关闭 RAG；已绑定会话只使用服务端确认的作品范围。
9. 归属失败在 provider 调用前返回现有错误语义。
10. completion 与 streaming 的 wire payload 转换结果一致，只有 stream 参数不同。
11. fake transport 捕获的 wire payload 与真实 transport 发出的 body 结构一致。
12. observer 对缺失、错误位置和重复 current-user 结构不产生虚假成功事实。
13. observer 白名单不包含 raw 内容，observer 异常不阻断主请求。
14. 生产 Mock 配置请求级 fail closed；测试 Mock 仍可显式使用。
15. SSE abort、终止单发、close-once 和安全错误保持既有对外语义。
16. 现有 chat、chapter continuation、compress、skills、pipeline tests 继续通过。
17. TypeScript、完整 Vitest、production build 和干净 checkout 检查通过。
18. 真实 one-api smoke 验证独立/章节消息、压缩请求和 SSE 到达真实网关；内部脱敏 observer 由本地测试 seam 验证，不声称真实 one-api 证明 scope metadata。

### 既有测试 prior art

- 独立 chat HTTP consumer、消息持久化和 SSE 回归测试；
- chapter continuation HTTP consumer、章节历史和注入链测试；
- compression threshold、kept history 和 completion adapter 单测；
- pipeline stream consumer 测试；
- 现有 payload observer 与 writing-context 测试作为 prior art，但必须修正为双 seam 证据，不能继续只捕获中间对象。

## Out of Scope

- generationKey、候选状态机、候选 replay、discard、正文 revision/expectedContent 冲突、stop/retry/duplicate apply/并发 apply；
- 候选生命周期的 schema/migration；
- 新表、embedding、Canon 编译器、多 Agent、工具调用、插件市场和工作流编排；
- 新聊天 UI、编辑器重构、Undo/Redo、正文保存、插入正文和既有冲突保护语义；
- 会员、支付、额度产品改造、跨设备会话和 WebDAV；
- 复制生产用户数据到测试；
- 生产 raw prompt、正文或诊断调试 API；
- 在本 effort 完成前构建镜像、修改 Secret、执行 Cloud Run migration、切流或部署生产。

## Further Notes

1. 当前 hardening effort 位于 `.scratch/mozhou-writing-context-repair-hardening/`，四张工单按 `01 → (02,03) → 04` 的 blocking edges 执行。
2. 候选生命周期必须另建独立 effort，最低规格包括 schema/migration、generationKey 幂等与冲突、generating/completed/stopped/error/applied/discarded、章节 replay、正文 revision 冲突、stop/retry/duplicate apply/并发 apply 和既有 SSE 事件契约。
3. 实现前必须保留从 `0536fa9` 的干净 checkout 证据；实现后必须重新运行 code-review，分别审查 Standards 与 Spec。
4. 本 Spec 不把“已有公网 URL 返回 200”视为本 hardening 已部署证据；部署属于单独发布门禁。

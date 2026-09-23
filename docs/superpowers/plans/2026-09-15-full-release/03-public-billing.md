# 公网身份、商业化与部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans task-by-task. 本部分不能由“本机可用”推导“公网安全”。

**Goal:** 多用户公网创作、同账号双端权益、微信/支付宝实际付款与额度结算。
**Architecture:** 明确local/hosted两模式；共用小说内核；认证、书归属和订单事务由服务端控制。
**Tech Stack:** Node现有后端、Supabase Auth维护SDK、独立业务SQLite、官方支付SDK/协议、现有Tauri。
**Spec:** SPEC.md、CONTRACTS.md C1/C4；仅无同步被排除。

## T08 — 账号注册登录恢复与Windows登录

**Modify:** apps/web/server/api.ts、router.ts、security.ts；src/App.tsx、src/membership/MembershipView.tsx。
**Create:** apps/web/server/auth/{session,deviceFlow}.ts及各自.test.ts；routes/accountRoutes.ts、accountRoutes.test.ts；src/account/AccountView.tsx。
**Input:** T01可用Supabase项目/回调/真实邮件；**Output:** 服务端VerifiedPrincipal与设备会话，不包含小说目录权限。

- [ ] 使用Supabase当前维护SDK的服务端会话验证；只把经过验证的subject当userId。不解码JWT后直接信任、不把service-role/admin key下发。
- [ ] 网站注册/邮箱确认/登录/退出/过期刷新/忘记密码，cookies为HttpOnly/Secure/SameSite，写请求校验精确Origin与CSRF令牌。重置token一次性、限时、不记录。
- [ ] 登录/重置限速（按IP及账户），错误不泄露账户是否存在；每次退出使服务器会话/设备refresh失效。
- [ ] Windows用系统浏览器完成账号授权，以随机state+PKCE和一次性短期code绑定本次安装。回调只允许精确注册地址，code重复/超时/错state都拒绝。
- [ ] local服务bootstrap token每次进程启动随机生成，原生通道传给同窗口；后端除了回环/Origin还验证token，避免任意网页对localhost发起写操作。不在URL/query/日志中放token。
- [ ] 设备列表最多3个有效绑定，服务端判定；解绑后不能继续刷新票据。离线基本创作不需登录。
- [ ] 首次账号登录不读取/上传Windows作品；只同步账户身份与权益。账号删除明确处理网站书导出/删除及订单法定保留边界，不能误删本机作品。

**Tests（新增accountRoutes.test.ts，真实HTTP+测试Auth服务；另外实际Supabase验收）：**

~~~text
未登录 GET account → 401；伪造subject/token → 401；
A退出后旧cookie → 401；错误Origin写请求 → 403；
重置code两次消费 → 首次成功、第二次拒绝；过期code拒绝；
device code由另一state兑换 → 拒绝且原code不被错误消费；
第4设备拒绝；解绑后原refresh拒绝；两个用户看不到彼此设备。
~~~

**Command:** pnpm --filter @mozhou/web test -- server/auth server/routes/accountRoutes.test.ts
**Pass:** 实际注册邮件→登录→重置→桌面授权协议客户端（系统浏览器与真实本地回调接收器）→退出完整走通；打包后的原生集成归T17；无账户凭据出现在截图/静态包。
**Rollback:** 撤掉新登录入口，保留会话撤销/设备历史；不恢复已撤销token、不把安全失败改成guest管理员。

## T09 — 公网作品归属和全路由隔离

**Modify:** apps/web/server/router.ts、security.ts、api.ts、productionServer.ts、所有server/routes及src/api/client.ts、src/lib/post.ts、书上下文消费者。
**Create:** server/bookAccess.ts、routePolicies.ts、tenancy.test.ts；server/account/store.ts。
**Input:** T08 verified principal；T00书格式；**Output:** C1 AuthorizedBook，hosted模式拒绝root/dir/path输入。

- [ ] 在后端创建每用户bookId→root注册表；路径完全由服务器生成，实际realpath必须位于当前user的目录内。禁止符号链接穿出。
- [ ] 用明确routePolicies表分类每个API为public/account/book/local-native/payment-webhook；未知路径默认拒绝。自动化检查当前所有注册路由都在表中。
- [ ] hosted只从已认证session取userId；把request.bookId解析成AuthorizedBook供handler使用。不可仅改正文，遗漏receipt、ledger、tasks、assets、backup和分镜。
- [ ] local以原生目录选择登记bookId，同一客户端结构适配本地服务。旧root/dir接口在迁移结束后删除，不保留公网兼容分支。
- [ ] 文件上传流式限额、UUID文件名、扩展/内容双校验；下载每次重新授权；模型输入字符串不参与文件路径/SQL拼接。
- [ ] hosted reject内网/云metadata SSRF，静态文件只从dist读取；代理信任只限部署的代理地址，不信任任意X-Forwarded-For/Host。
- [ ] 进程级排他启动锁+每书队列；不启动多实例挂同SQLite卷，不把Windows设备身份当公网租户。

**真实HTTP负例矩阵（tenancy.test.ts逐端点参数化运行）：**

~~~text
主体A + bookB → 404（正文/提案/候选/receipt/任务/导出/备份/分镜/删除全部如此）
主体A + root="../../..." 或 dir/absolutePath → 400，无磁盘变化
主体A + B的candidateId/receiptId/jobId → 404
主体A + 自己book但path替换为symlink → 拒绝
无认证 + 任意非公开API → 401
API新路由未登记policy → 测试失败/运行拒绝
第二服务进程争夺同一个dataRoot → 启动失败，不开始监听
~~~

**Command:** pnpm --filter @mozhou/web test -- server/tenancy.test.ts
**Pass:** 两真实账号实际创建隔离作品、交叉请求无越权、拒绝后所有源文件hash不变；本地模式后端仍可打开旧格式测试书；安装版打开旧书归T17。
**Rollback:** 一旦隔离未通过，hosted入口继续关闭。不要通过关闭auth/Origin使“公网能访问”。

## T14 — 真实订单、微信与支付宝回调

**Modify:** src/membership/MembershipView.tsx、server/routes/systemRoutes.ts、server/api.ts、productionServer.ts。
**Create:** server/billing/{contracts,catalog,store,wechat,alipay,notifications}.ts及各自.test.ts；server/routes/billingRoutes.ts；server/billing/migrations/001-orders.sql。
**Input:** T02 catalog、T08身份、T09隔离、T01商户；**Output:** C4两个渠道均可付款，事务唯一发权益。

本项真实回调不等待 T16 的完整网站：在 T01 已可用的 HTTPS 主机上部署仅测试账户可用的当前账户/订单服务，固定源码版本、隔离测试数据库、关闭公众购买，按 T16 相同的持久卷/鉴权/反代规则设置回调；优先复用已有预发布部署配置。测试服务也是本项交付物。若主机/商户缺失，本项外部验收 blocked；不能把本机伪回调写成真实支付。T16 后续接入完整创作网站，并在域名/逻辑改变时重验回调。

- [ ] 实现独立订单库迁移。不要在每书runtime.sqlite存用户付款或拿新建书触发billing迁移。
- [ ] 建order的金额从catalog取；UUID订单号；同用户同idempotencyKey同body返回同订单，不同body返回409。
- [ ] 微信用已获批Native产品；支付宝优先已签约扫码/收银台产品；真实SDK版本与官方URL写入证据。渠道必须先具备签约权限，不能用个人收款码/截图自动激活。
- [ ] 支付通知路由在通用JSON解析前保留原始bytes/form；只针对该路由豁免登录/CSRF，并用支付验签作为真实性边界。请求大小≤256KiB。
- [ ] 校验签名/证书、时间窗口、商户/AppID/币种/金额/orderId/tradeState；外部数据不覆盖本地userId/planId。未持久化完成不返回成功ack。
- [ ] 通知在单事务内recordEvent→确认订单→grant entitlement一次；重复与乱序通知正确ACK，不重复延长有效期。
- [ ] 回调丢失通过有界主动查单恢复（pending订单间隔退避，最多24h，之后关单/人工处理）；不以浏览器return_url或“我已支付”按钮为准。
- [ ] 退款有服务端运营权限/审计，金额≤实付；退款确认后撤销对应未消费权益或按明确退款政策结算，保留用户作品；同退款号重复回调不重复扣权益。

~~~sql
-- 001-orders.sql的核心约束，字段补足C4；不能删约束让测试通过。
CREATE UNIQUE INDEX orders_user_idempotency ON orders(user_id, idempotency_key);
CREATE UNIQUE INDEX orders_provider_tx ON orders(channel, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX payment_events_unique ON payment_events(channel, event_id);
CREATE UNIQUE INDEX grants_once_per_order ON entitlement_grants(order_id);
-- amount_fen INTEGER NOT NULL CHECK(amount_fen>0), currency='CNY'
-- 交易处理 BEGIN IMMEDIATE / COMMIT，失败 ROLLBACK，不跨await持有事务等网络。
~~~

**Tests:** 伪签名、正确签名错误金额/商户/AppID/币种、A查B订单、回调20并发重复、paid后迟到closed、退款先于本地pay回调、DB写失败后通知重发、服务重启后主动查单。
**Command:** pnpm --filter @mozhou/web test -- server/billing server/routes/billingRoutes.test.ts
**Real pass:** 先验证渠道提供的官方沙箱/测试能力；渠道未提供沙箱则记录限制，使用签名协议负例测试加商户认可的真实验收，不虚构沙箱通过。再由用户执行商户允许的真实验收交易（测试商品及金额须按渠道规则登记，不能篡改正式catalog降价）；服务端验证实际回调和查单一致、权益到账一次、退款/关闭路径可回查。金额不可由AI代用户任意支付。实际支付未完成只能标blocked。
**Rollback:** 先关闭新订单创建，保留回调/查单/退款服务直到在途订单结清；绝不回滚DB删账或重新发货。

## T15 — 权益、官方模型额度与双端授权

**Modify:** server/routes/pipelineRoutes.ts、storyboardRoutes.ts、systemRoutes.ts；新增分析/搜索路由；UI会员/模型设置。
**Create:** server/billing/{entitlements,quota,license}.ts及.test.ts；server/routes/managedModelRoutes.ts、managedModelRoutes.test.ts。
**Input:** T14已确认订单、T07模型传输、T02catalog；**Output:** 服务端按权益控制所有高级能力，C4额度预留/结算。

- [ ] 建 capability→requiredEntitlement 单一映射；所有高价API同一检查。改localStorage.vip/客户端plan字段不能获得服务器服务。
- [ ] Pro解锁高级软件功能，BYOK走自己的Key；Max可用managed broker。两个轨道任务记录不同计费来源，不能混扣。
- [ ] 事务预留 (userId,operationId) 的调用单位+token预算+最大费用；20并发在余额1时只能一个成功；其他拒绝/排队。
- [ ] 成功按实际usage结算；明确未调用上游的取消释放；部分生成/上游收过费的失败依照公开规则收费且保存结果，不能自动无限退款刷额度。
- [ ] 设置账户月/日预算、服务全局日成本断路器和最大并发；每任务尝试成本累加。预算拒绝给余额/恢复日期，不私自降级模型。
- [ ] 离线票据Ed25519签名，server time/expiry/deviceId绑定，72h以内宽限；长期离线仍可编辑/导出/备份，但不授权联网managed请求。
- [ ] 月末/闰年/续费/升级待生效/退款/设备撤销/签名key轮换测试；历史priceVersion固定。quota价格变化只影响新订单。

**Tests:** 改本地会员、伪造签名、旧票据重放、错设备、到期、client clock回拨、重复operation不同prompt、network timeout后重试、恢复pending reservation、退款和任务结算乱序。
**Command:** pnpm --filter @mozhou/web test -- server/billing/entitlements.test.ts server/billing/quota.test.ts server/billing/license.test.ts server/routes/managedModelRoutes.test.ts
**Pass:** 支付→网页解锁→桌面协议客户端授权→真模型一次→余额恰减一次→退出/退款撤销完整链路；安装版Windows集成归T17；基础作品访问从不锁死。
**Rollback:** 停止managed新任务，保留待结算预留与订单；回滚provider不改账本或已售额度。

## T16 — 公网实际部署与网站旅程

**Modify:** apps/web/server/productionServer.ts、scripts/launcher.mjs、Dockerfile（先读当前内容）；NEW deploy/Caddyfile、deploy/mozhou.service、deploy/README.md、scripts/release/hosted-smoke.mjs。
**Input:** T01真主机/域名、T09隔离、T07provider、T10备份、T14/15支付；**Output:** 私有/预发布HTTPS站与完整部署恢复证据。

- [ ] 首选用户成功取得的Oracle免费持久VM；安装时只使用已授权资源。无实例/卷/域名则本项blocked，不把本机Tunnel当生产唯一主机。
- [ ] Node以非root专用用户运行，服务端代码与dataRoot分离；单写实例锁，持久卷至少支持SPEC测试集。HTTPS反代同源UI/API，禁止公开DB/管理端口。
- [ ] 本任务先从已记录的源码版本构建内部预发布运行时，使用独立 staging 输出目录；先将 scripts/build-release.mjs 的输出改为唯一运行目录，保留已有产物，禁止递归删除旧 release-artifacts。记录源码、配置摘要和文件哈希。本项不等待 T20 的最终资产，也不创建公开 Release；T20 在全部验收后重新构建最终候选。部署机器只接收这个内部运行时，不从脏源码现场构建；配置/secret由环境与权限受限文件注入，日志脱敏。
- [ ] 先跑目标OS native dependencies probe，再开服务；重启VM后用户书/候选/订单/权益都存在。ARM/x64二进制不混用。
- [ ] 支付回调不缓存、生成stream不buffer；写API不缓存；TLS、CSP、cookie、反代Origin设置真实验证，不为过关设CORS:*。
- [ ] 预发布两个独立真实账号：注册、建书、生成、采纳、定稿、分镜、导出、恢复、支付，两用户交叉访问拒绝。
- [ ] 断网/模型429/重启/磁盘不可写/存储接近配额→中文错误且数据保留。服务运行探针从外部网络访问，不只curl localhost。
- [ ] 按日备份到与运行卷不同故障域；Auth/业务订单库与书数据分别恢复演练；服务依赖暂停/免费资源回收时有明确恢复手册，不承诺零停机SLA。

**Command:** node scripts/release/hosted-smoke.mjs --base <EXTERNAL-INPUTS中真实预发布URL>
此脚本由本项创建；参数必须解析/校验HTTPS；测试账号用secret引用，不写命令行密码。
**Pass:** 网站重启后真实数据一致；HTTPS公开访问和回调可达；已完成商户/模型实测；无跨用户访问。
**Rollback:** 切回前一release目录，保留dataRoot，schema不兼容则按备份恢复到新目录验过再切；有在途支付继续处理回调，不能直接关账。


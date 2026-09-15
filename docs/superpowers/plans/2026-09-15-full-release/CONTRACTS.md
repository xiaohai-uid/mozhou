# 拟新增/修改契约：实现前的固定接线图

本文件全部 NEW 类型/端点是计划产出，当前不存在。执行者必须在对应任务创建后才能引用。原有导出从实际 packages/*/src/index.ts 查，不猜名字。
新增跨端纯 API 类型放 NEW apps/web/shared/releaseContracts.ts；AuthorizedBook及身份解析只放server/bookAccess.ts。WriteBase和DraftCandidate的唯一领域定义放packages/pipeline/src/draft-candidate.ts并从包index导出，共享API文件用import type引用；包层禁止反向import apps/web。下方重复出现的类型名是合同引用，不要求在多个文件重复定义。跨端纯类型不能 import 服务端实现或密钥。
现有 API 错误形状继续使用 ok:false, code, error；错误不要泄露服务器绝对路径。

## C1. 请求身份与作品归属（T08/T09）

~~~ts
type RuntimeMode = 'local' | 'hosted';
type BookRef = { bookId: string }; // 公网和新客户端使用
type AuthorizedBook = {
  ownerId: string; // 本地为固定安装身份，公网来自已验证会话
  bookId: string;
  root: string; // 只存在服务器内部
};
type WriteBase = { revision: number; sha256: string };
type OperationIdentity = { idempotencyKey: string }; // 16–128 ASCII，服务端校验
~~~

NEW apps/web/server/bookAccess.ts：

~~~ts
// 实现：先认证，再查 owned book，再 realpath 限制，最后才读书。
async function resolveAuthorizedBook(req: IncomingMessage, bookId: string): Promise<AuthorizedBook>;
~~~

local 老 root 接口仅在 T09 迁移窗口中保留，完成客户端迁移后删除；不得公网兼容 root。
新建书只收 title，不接受 dir；local 的目录选择由受控原生操作注册后返回 bookId；hosted 的路径固定在持久卷 users/<serverUserId>/books/<serverBookId>。
library、tasks、receipts、export、backup、storyboard、assets、billing、provider-settings 全部做相同归属检查；只改正文路由不合格。

## C2. 候选与受控采纳（T03–T05）

NEW packages/pipeline/src/draft-candidate.ts，数据不包含 owner 权限裁决：

~~~ts
type CandidateStatus = 'streaming' | 'partial' | 'ready' | 'accepted' | 'cancelled' | 'failed';
interface DraftCandidate {
  schemaVersion: 1;
  id: string; operationId: string; bookId: string; chapterIndex: number;
  base: WriteBase; mode: 'replace' | 'continue' | 'insert' | 'replace-selection';
  text: string; status: CandidateStatus;
  selection?: { from: number; to: number; selectedTextHash: string };
  acceptedRevision?: number;
}
~~~

对应方法（任务中须实现并从 index.ts 导出）：
createDraftCandidate / readDraftCandidate / appendCandidateDelta / finishCandidate / cancelCandidate / acceptDraftCandidate。
方法参数统一首参 AuthorizedBook 对应的已核准 root，再传 id 或结构化请求；包层校验 bookId/chapterIndex/base，HTTP 层负责 ownerId。

存储：<书>/.mozhou/candidates/<服务端生成id>.json；这是需恢复/备份的候选记录，不是可随重建删除的投影缓存。客户端和模型不能指定文件路径。

~~~text
POST /api/draft.stream
  request: {bookId, chapterIndex, base, mode, prompt, activeSkills, idempotencyKey, selection?}
  start: {ok:true,event:"start",candidateId,operationId,base,provider,contextTokens}
  delta: {ok:true,event:"delta",candidateId,sequence,text}
  done: {ok:true,event:"done",candidateId,status:"ready"|"partial"}
POST /api/draft.cancel
  request: {bookId,candidateId}
POST /api/draft.accept
  request: {bookId,candidateId,base,idempotencyKey}
  response: {ok:true,candidateId,chapterIndex,revision,sha256,alreadyApplied:boolean}
POST /api/draft.candidate
  request: {bookId,candidateId}
  response: {ok:true,candidate:DraftCandidate}
  复用同一认证/书归属，不能凭candidateId跨书取稿。
~~~

Accept 的正确次序：

~~~text
resolveAuthorizedBook
→ withBookWriteLock
→ load candidate; compare candidate.bookId/chapterIndex/base + current chapter identity
→ compare current revision AND raw file hash; verify draft phase
→ verify candidate still ready/partial explicitly confirmed, operation not cancelled
→ append durable accept intent (candidateId, before/after hashes, idempotencyKey)
→ saveProseDraft(shared CAS + external-hash guard)
→ append accept completion; atomically mark candidate accepted with resulting revision
→ return saved snapshot
~~~

出现“正文已写但 candidate 标记未写”的崩溃窗口：恢复按 intent 的 afterHash/currentRevision 查同一成功结果，不能再次追加正文或再次涨版本。不可只用内存 Set 去重。
continue 保存原文+候选增量；replace 替换全文；insert/selection 用生成开始时位置+选区 hash，发生编辑则 409 并保留候选，不按新光标猜位置。
拒绝客户端传 confirmExternalOverwrite=true 就静默替换；UI 必须展示最新文本并明确确认，参数只能对应当前读到的 base。
所有程序内写者复用同一书锁；第二进程通过进程锁拒绝成为写者。对不遵守锁的外部编辑器，要做写前 hash 检测及冲突副本，报告实际覆盖的竞争时间点，不声称任意文件系统并发绝对线性化。

## C3. 生产会话（T06）

NEW POST /api/production.command：

~~~ts
type ProductionCommand =
  | {type:'start'; chapterIndex:number; base:WriteBase}
  | {type:'review'; taskRef:string; base:WriteBase}
  | {type:'rework'; taskRef:string; reportId:string; base:WriteBase}
  | {type:'extract'; taskRef:string; base:WriteBase}
  | {type:'decide-proposal'; taskRef:string; proposalRef:string; itemId:string; action:'confirm'|'reject'|'editAccept'; value?:unknown}
  | {type:'commit'; taskRef:string; base:WriteBase}
  | {type:'cancel'; taskRef:string}
  | {type:'resume'; taskRef:string};
// 外层 {bookId,idempotencyKey,command}; taskRef只能属于解析后的book。
~~~

原 /api/session.advance 不能成为跳过质量门的通道：转为内部状态机操作或删除公开入口。
复用 ChapterProductionSession、prepareChapterInputs、runCompileStep、executeChapterReview、runFinalExtract、runContinuityGate、ProposalPort、LocalDataPlane.commitChapter、runFlywheelRecord；不得另写十步引擎。
每一步保存的输入/结果标识、requestId、对应章版本均入账。resume 重跑未完成的幂等步骤，不用伪造一个“已成功”的空结果推进。

## C4. 支付、权益、额度（T14/T15）

NEW apps/web/server/billing/contracts.ts：

~~~ts
type PlanId = 'pro_monthly' | 'max_monthly';
type PayChannel = 'wechat' | 'alipay';
type OrderState = 'created' | 'pending' | 'paid' | 'closed' | 'refund_pending' | 'refunded';
type Money = { currency:'CNY'; amountFen:1900|3900 };
interface OrderSnapshot {
  orderId:string; userId:string; planId:PlanId; channel:PayChannel;
  priceVersion:string; amountFen:number; currency:'CNY'; state:OrderState;
  periodStart:string; periodEnd:string;
}
~~~

~~~text
POST /api/billing/orders {planId,channel,idempotencyKey} → {orderId,checkoutUrl,expiresAt}
GET  /api/billing/orders/<id> → 自己订单的脱敏状态
POST /api/payments/wechat/notify → 原始body验签/解密后的事务处理
POST /api/payments/alipay/notify → 原始form验签后的事务处理
GET  /api/account/entitlements → 服务端裁决的权益/有效期/额度
POST /api/billing/refunds → 有授权的运营动作，不是普通用户自由改金额接口
~~~

金额只从服务端不可变 catalog 取得。订单创建后的 priceVersion/金额/用户不能重写。支付渠道 transactionId 唯一，(channel, providerEventId) 唯一，(userId,idempotencyKey) 唯一。
在一次 DB 事务中：核验当前订单状态 → 幂等记录回调 → paid → 权益授予一次。签名有效但金额/应用/商户不匹配也不发权益。
伪造浏览器跳转、扫码图片、本地付款按钮、会员缓存字段都不是付款成功。

NEW quota reservation：任务上游调用前以 userId+operationId 原子预留；完成结算；明确未产生费用才释放；不确定结果走查单/人工核对，不可双扣或无限重试。同时设置请求次数、token、人民币成本、日总成本四道上限。
官方套餐模型 Key 仅在 hosted，Windows 只向官方 broker 发送已授权任务；BYOK 不使用平台额度。每次尝试都记录真实 provider/model/version、usage 与成本，无法取 usage 则按冻结上界估算并标 estimated。
“无作品同步”不等于联网模型完全不接收文本：BYOK将本次必要上下文发给用户选定模型；managed将必要上下文经官方broker发给供应商。设置页和首次启用时明确此路径；不整书上传、不得在服务器创建本地书副本、默认不将正文/提示词写入服务日志。故障诊断材料只在用户明确导出时包含其选择的文本。仅同步账户权益的请求不能附带作品内容。
Windows 离线只缓存服务端签名的短期权益（Ed25519，内置公钥，私钥永不分发）；离线宽限≤72小时且不超过已付到期日。平台算力必须在线核验，不能靠签名本地票据无限调用。不得宣称本地客户端绝对防破解。

## C5. 备份与资料来源（T10/T11/T12）

backup manifest：schemaVersion/bookId/createdAt/files[{path,bytes,sha256}]/appVersion。包含正文、设定、大纲、分镜、作者风格、不可重建账本/提案/候选；排除凭据、账号/订单库、模型缓存和可重建 SQLite projection/WAL/SHM。
备份期间与书写锁一致：要么得到同一个提交点的快照，要么失败；不能 live copy 活跃 SQLite 后说一致。
恢复只解压到新目录：拒绝绝对路径、..、符号链接、重复路径、大小写折叠重名、超额条目/体积、hash不符。全部校验成功后原子登记为新书；失败清理的仅是本次暂存目录，原书零变更。

搜索/榜单结果每项 sourceUrl、fetchedAt；缓存还带 cachedAt/stale。失败用明确错误/真实旧缓存，不把内置样例补回结果。
拆书/风格分析每项 sourceSpan/sourceHash；模型生成建议与原文事实分开；用户确认才保存/应用。

# DELTA-002：任务重试与 WebDAV 推送新增限流响应

日期：2026-08-22　|　触发：商用就绪复审「昂贵端点无限流」债务项

## 变更内容

1. `POST /api/v1/runtime/jobs/{jobId}/retry` 新增 **429**（Retry-After）：
   桶=`jobretry:<userId>`，`RATE_LIMIT_JOB_RETRY_PER_MIN` 默认 **6/分钟**；
   消耗点在鉴权后、归属检查前（对不存在 jobId 的探测同样计入）。
   理由：retry 将 job 重新入队再执行 worker 步骤，可能产生新的模型调用费用。
2. `POST /api/v1/sync/push` 新增 **429**（Retry-After）：
   桶=`syncpush:<userId>`，`RATE_LIMIT_SYNC_PUSH_PER_MIN` 默认 **6/分钟**。
   理由：每次推送对全部作品逐章发起外部 WebDAV 请求（最多 3 次重试）。

## 同步面

- openapi.yaml：上述两条路径的 429 → `#/components/responses/RateLimited`
- api-contract.md §25：新增两行桶定义
- 实现：lib/http/rate-limit.ts（enforceJobRetryLimit / enforceSyncPushLimit）+ 两路由挂载
- 测试：tests/unit/job-sync-limit.test.ts（4）、tests/http/job-sync-rate-limit.test.ts（4）

## 不限流决策留档（同类扫描结论）

- rankings/scan：已有全局 60s 冷却（route 层自带 429），仅补契约记载
- chapters/chat/stop、runtime jobs 读面、market/styles CRUD 等：索引读或带状态机/幂等键守卫，
  且 events 为设计上的轮询端点——套共享桶会误杀合法轮询；维持不限流

---
date: 2026-08-24
description: '#30 B 路：BYOK 三家（DeepSeek/GLM/Claude）五问取证与 M18 四要素落点对照——主会话接管完成，全部结论带一手文档出处'
tags:
  - mozhou
---

# T30-B · BYOK Provider 差异取证（DeepSeek / GLM / Claude）

> 对应票：[研究票 #30](https://github.com/xiaohai-uid/mozhou/issues/30)。相关笔记：[[t30-runtime-substrate-evidence]] · [[2026-08-24-wayfinder-phase-3-map]]
> **生产说明**：原 B 路子会话超时未落盘（约 65 分钟），主会话按预案接管，基于本地 crawl4ai 对一手官方文档的探针抓取完成（原始快照存 `~/t30-probes/`：ds-json/ds-cache/ds-errors/ds-sse、glm-json/glm-cache/glm-errors/glm-stream、an-stream/an-cache/an-struct/an-errors）。

## 五问 × 三家对照表

| 问题 | DeepSeek | GLM (Z.ai) | Claude (Anthropic) |
|---|---|---|---|
| **Q1 SSE 流式** | OpenAI 兼容 data-only SSE；`data: [DONE]` 终止；`stream_options.include_usage` 使末尾多一个 usage chunk（choices 为空数组）；`finish_reason=length` 时内容可能截断 | 同为 choices-delta 制：`choices[0].delta.content` + `delta.reasoning_content` 增量；`finish_reason` 与 `usage` 仅出现在最后一个 chunk | **命名事件制**：每事件 `event: <type>` + 带 `type` 的 JSON data（`content_block_delta`→`delta.type=text_delta`、`message_stop` 等）——与 data-only 制是两套解析器 |
| **Q2 结构化输出** | `response_format={'type':'json_object'}`：宽松 JSON 模式，**无 schema 校验**；须 prompt 含 "json" 字样+格式示例；必须设 max_tokens 防截断 | `response_format={"type":"json_object"}`：同为宽松 JSON 模式，未见 json_schema 级支持 | **真 schema 级**：`output_config.format` + `json_schema`（由 beta output_format 迁移）；另有 strict tool use（`strict: true` 保证工具名/入参 schema 校验） |
| **Q3 Prompt Caching** | **全自动隐式 KV 缓存**：无显式断点可设；硬盘缓存、闲置数小时~数天自动清除；usage 以 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 区分计费 | **自动缓存识别**（implicit）：无需配置；`usage.prompt_tokens_details.cached_tokens` 展示命中量 | **双模唯一家**：`cache_control` 自动模式（顶层单字段、断点自动前移适合多轮）或显式 breakpoints（逐 content block 细粒度控制），TTL 5min/1h；usage 用 `cache_creation_input_tokens` / `cache_read_input_tokens`；低于最小 token 数静默不缓存 |
| **Q4 错误分类学** | HTTP 直码表：400 / 401 / 402 余额不足 / 422 参数错 / 429 限流（官方建议临时切备用供应商）/ 500 / 503 过载 | **双层码最细一家**：外层 HTTP + 内层业务码——1113 余额不足(429)、1302 限流(429)、1305 过载(429)、1308/1310 周月用量限额、1309 套餐过期 | named error_type 体系：`invalid_request_error`(400)、`rate_limit_error`(429，tier spend-cap 无 retry-after 头)、`overloaded_error`(529) 等 |
| **Q5 base_url 自定义** | `api.deepseek.com`（OpenAI 兼容）；另提供 Responses API 与 Anthropic 兼容 API 双兼容面 | `api.z.ai/api/paas/v4`（OpenAI 兼容）；文档站全量 md 经 `/llms.txt` 开放 | `api.anthropic.com` + `anthropic-version` 头；docs 已 301 迁移 platform.claude.com |

## M18 四要素 × 三家落点

| M18 要素 | 取证结论 |
|---|---|
| 自定义 provider | adapter 至少两套协议栈：OpenAI 兼容 data-only SSE（DS/GLM 共用）+ Anthropic 命名事件 SSE；GLM reasoning_content 字段是第三处差异 |
| base URL 相对化 | 三家均可换端点；DSH settings.yaml 的 `baseURL`/`api` 字段结构（A 路 §2.1）可直接沿用为注册表形态 |
| 连接测试 | A 路实证手编 YAML 有脏数据（前导空格 baseURL）+ 三家错误码体系迥异 ⇒ 连接测试应打真实最小请求并按家归一化错误分类 |
| 缓存友好 prompt 前缀 | **三家机制互不相同且 usage 字段名各异** ⇒ 「前缀稳定性」策略必须按 provider 参数化：DS/GLM 靠稳定前缀自动命中，Claude 可显式摆断点；adapter 需统一缓存命中计量接口（三家字段名映射表见上） |

## 对 M17 三级降级的直接含义

DeepSeek 与 GLM 均只有宽松 json_object（无 schema 校验、依赖 prompt 引导、有截断风险）⇒ **M17「宽松 schema → 定向重生坏字段 → 人工模板兜底」的宿主侧责任落在 adapter/capability 层而非供应商**；Claude 的 json_schema + strict tools 能把第一级做实，但降级链对三家都必须保留（schema 合法 ≠ 语义正确）。

## 取证局限

1. 探针为静态文档抓取，未发真实 API 请求实测（连接测试行为、实际缓存命中率待实现票验证）
2. GLM 错误码仅录关键几条（1113/1302/1305/1308/1309/1310），完整业务码表见 docs.z.ai/api-reference/api-code.md
3. Claude structured outputs 的 output_config.format 为近期迁移后形态，SDK 版本敏感（Python SDK v1.0+ 不再收旧参数）
4. 定价/限额数字未取（变化频繁且非本票范围）

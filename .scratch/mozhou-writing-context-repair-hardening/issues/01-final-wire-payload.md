## What to build

建立 `PreparedChatRequest → ProviderWirePayload` 唯一转换和 fake transport 捕获 seam，覆盖 system envelope、messages 顺序与最终 provider body。

**Blocked by:** none  
**Status:** ready-for-agent

## Acceptance

语义 seam 与 wire seam 的测试均能读取真实 consumer 产物；fake one-api body 与 transport 实际发送结构一致。

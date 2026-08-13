## What to build

生产环境 `CHAT_PROVIDER=mock` 请求级 fail closed；测试环境 Mock 行为保持可用。

**Blocked by:** 01-final-wire-payload  
**Status:** ready-for-agent

## Acceptance

生产配置不会输出模拟内容或静默切换 provider；响应只暴露通用错误。

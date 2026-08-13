## What to build

Observer 从最终语义/wire payload 派生 current-user、role、数量和 system sections，不把 caller indices 作为权威事实。

**Blocked by:** 01-final-wire-payload  
**Status:** ready-for-agent

## Acceptance

缺失、重复、错误位置的 current user 都能被测试捕获；日志白名单和 fail-open 保持不变。

# Contract Delta 002：生产 Mock 配置 fail closed

状态：待实现前审阅  
日期：2026-08-13

## 变化

当 `NODE_ENV=production` 且 `CHAT_PROVIDER=mock` 时，transport composition root 抛出配置错误；请求不会进入 Mock，也不会静默切换到 one-api。

## 不变

测试环境仍可显式使用 Mock；客户端只接收既有通用错误语义，不暴露配置详情。

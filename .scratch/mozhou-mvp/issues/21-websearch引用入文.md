# 21 — websearch 引用入文（V1.1 Journey ⑤）

**What to build:** 搜索结果多选 → 引用入文 → 回流写作对话（chat 消息插入，`【引用资料】` 格式）。

**Blocked by:** —（契约 23 已 Frozen；websearch 搜索真实已就绪；deconstruct 回流通道为先例）

**Status:** done（2026-08-11）

**决策（spec.md Journey ⑤）：** 去向=写作对话消息插入（R2 消息插入语义）；形式=多选合并一次插入；通道=sessionStorage `mozhou_pending_websearch`（对齐 deconstruct 回流）

**契约（api-contract.md 第 23 节）：**
- 无新端点；回流通道 sessionStorage + chat 页读取插入
- 消息格式：
```
【引用资料】标题（来源）：摘要…
来源：URL
```

- [ ] websearch-view：结果多选（checkbox）+ "引用入文（N）"按钮 → 存 `mozhou_pending_websearch` → 跳转 /chat
- [ ] chat-view：读取 pending_websearch → 插入用户消息（`（导入搜索引用）` + 格式文本，对齐 deconstruct 回流块）
- [ ] 浏览器 E2E：搜索 → 勾选 2 条 → 引用入文 → chat 页消息出现且格式正确
- [ ] 契约文档已并入（23 节）

**验收：** 搜索勾选多条 → 引用入文 → 写作对话出现 `【引用资料】…` 消息（含标题/来源/摘要/URL）。

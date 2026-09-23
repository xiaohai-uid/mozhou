# 已捕获的真实 HTTP / 文件系统回归

这两个脚本针对 C:/zcode/novel-ai 当前本地 API，使用系统临时目录创建测试书；保留测试目录和 result.json，绝不读取或改写作者真实书。源码修改后先重新构建，避免检验旧 dist。

~~~powershell
Set-Location C:\zcode\novel-ai
pnpm build
pnpm --filter @mozhou/web build
node docs/superpowers/plans/2026-09-15-full-release/regressions/verify-stream.mjs
node docs/superpowers/plans/2026-09-15-full-release/regressions/verify-manual-save.mjs
~~~

- verify-stream.mjs：修复前应退出 1，证明未采纳的生成已经覆盖作者正文。输出也记录流中外部编辑丢失与过期 revision 保存结果。使用合成模型流，不能证明真实供应商正常。
- verify-manual-save.mjs：当前基线应退出 0，证明手动保存的过期版本、外部修改、双编辑器、定稿保护和显式重开行为。流式路径修复不能破坏这些保护。

这些是已审计旧接口的复现样本，不是完整新功能验收。T03/T04 要新增候选采纳、竞争、崩溃、取消等 CONTRACTS.md 用例；实现 bookId、认证、候选接口之后可以适配请求与测试身份，必须保留原文不变/冲突拒绝等语义断言。旧脚本因 401/路由迁移失败不能当作产品行为已修复。不要将所有旧 501 接口保持不可用当作绿灯条件。

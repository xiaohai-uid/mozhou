/** 组件测试公共助手：构造 200 JSON Response（每次调用新建——Response 体只能消费一次）。 */
export function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 })
}

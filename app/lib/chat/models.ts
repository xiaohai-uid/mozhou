// 对话可用模型（客户端/服务端共享常量，避免三处复制）
// 免费源：SenseNova 托管 DeepSeek + 智谱 GLM（经 one-api 网关）
export const MODELS = ["deepseek-v4-flash", "glm-4.5-flash"] as const;

export type ChatModel = (typeof MODELS)[number];

export const DEFAULT_MODEL: ChatModel = "deepseek-v4-flash";

export function isChatModel(value: string): value is ChatModel {
  return (MODELS as readonly string[]).includes(value);
}

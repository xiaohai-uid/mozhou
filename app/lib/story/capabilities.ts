/**
 * oh-story capability registry.
 *
 * The original package is an agent skill collection, not a web API. This
 * registry is the boundary between those instructions and MoZhou's native
 * product flows: every capability names its actual adapter and its current
 * evidence state. A capability is never shown as "available" merely because
 * a prompt file exists.
 */
export type StoryCapabilityStatus =
  | "native"
  | "configuration_required"
  | "provider_required"
  | "workflow_required"
  | "external_source_required";

export interface StoryCapability {
  name: string;
  description: string;
  adapter: string;
  status: StoryCapabilityStatus;
  evidence: string;
}

export const STORY_CAPABILITY_STATUS_LABELS: Record<StoryCapabilityStatus, string> = {
  native: "原生可用",
  configuration_required: "需要配置",
  provider_required: "需要模型服务",
  external_source_required: "需要外部数据源",
  workflow_required: "需要作品工作流",
};

export const STORY_CAPABILITIES: readonly StoryCapability[] = [
  {
    name: "story",
    description: "网文工具箱路由与工作台入口",
    adapter: "/workspace",
    status: "native",
    evidence: "墨舟工作台与导航",
  },
  {
    name: "story-cover",
    description: "根据书名与题材生成小说封面",
    adapter: "/api/v1/story/cover",
    status: "configuration_required",
    evidence: "生产环境尚未配置图片 Provider；当前不提供文本伪封面",
  },
  {
    name: "story-deslop",
    description: "检测并清除 AI 写作痕迹",
    adapter: "/api/v1/tools/checks",
    status: "native",
    evidence: "通用机检已接入；完整改写需明确调用写作对话",
  },
  {
    name: "story-import",
    description: "导入用户拥有使用权的小说正文",
    adapter: "/deconstruct + POST /api/v1/novels/import",
    status: "native",
    evidence: "用户上传自有正文后，作品、首章与工作流同事务导入；requestKey 幂等",
  },
  {
    name: "story-long-analyze",
    description: "长篇结构、人物、节奏与黄金章节拆解",
    adapter: "/api/v1/deconstruct/analyze",
    status: "native",
    evidence: "使用现有 one-api 文本模型执行 Stage 0-6；阶段产物、质量警告、运行状态、重试与 UI 恢复均由墨舟原生持久化",
  },
  {
    name: "story-long-scan",
    description: "长篇平台榜单与题材趋势分析",
    adapter: "/api/v1/rankings",
    status: "native",
    evidence: "番茄真实榜源已接入；返回 source/capturedAt；不可用时空结果+degraded",
  },
  {
    name: "story-long-write",
    description: "长篇开书、大纲、章节写作与续写",
    adapter: "/projects + /chapter + /api/v1/novels/[id]/chapters/chat",
    status: "native",
    evidence: "首写、正文保存、候选确认、恢复与并发控制",
  },
  {
    name: "story-review",
    description: "多维小说质量、一致性与机检审查",
    adapter: "/api/v1/tools/checks",
    status: "native",
    evidence: "作品页逐章节调用六项机检；无虚构历史记录",
  },
  {
    name: "story-setup",
    description: "初始化作品、第一章与写作上下文",
    adapter: "/api/v1/novels/bootstrap",
    status: "native",
    evidence: "作品、第一章、工作流同事务创建，requestKey幂等",
  },
  {
    name: "story-short-analyze",
    description: "短篇故事核、情绪与反转拆解",
    adapter: "/deconstruct + /api/v1/deconstruct/analyze",
    status: "native",
    evidence: "使用现有 one-api 文本模型执行短篇 Stage 0/2-6；阶段产物、质量警告、运行状态、重试与 UI 恢复均由墨舟原生持久化",
  },
  {
    name: "story-short-scan",
    description: "短篇平台榜单与题材趋势分析",
    adapter: "/api/v1/rankings",
    status: "native",
    evidence: "番茄真实榜源已接入；返回 source/capturedAt；不可用时不展示样例榜单",
  },
  {
    name: "story-short-write",
    description: "短篇情绪驱动写作与成稿",
    adapter: "/chat",
    status: "native",
    evidence: "独立写作对话带身份基座，用户请求始终进入 messages",
  },
  {
    name: "storyrepo",
    description: "长篇章事务、追踪、检查、恢复与结算",
    adapter: "GET/POST /api/v1/novels/[id]/tracking",
    status: "native",
    evidence: "作品追踪真源、章节结算记录、审查历史、幂等 workflow run 已持久化",
  },
] as const;

export function getStoryCapability(name: string): StoryCapability | undefined {
  return STORY_CAPABILITIES.find((capability) => capability.name === name);
}

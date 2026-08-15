/**
 * ContextAssembler：唯一允许决定最终写作载荷的组件（契约 §7）。
 * 执行器只产 artifact；本模块把产物渲染为 WritingContextSection，
 * 按技能 tokenBudget 裁剪（culled 保留证据），并裁决 evidence = applied / not_applied。
 */
import type { WritingContextSection } from "@/lib/chat/writing-context";
import type {
  ArtifactKind,
  SkillDefinition,
  SkillExecutorOutput,
} from "./types";
import { estimateTokens } from "./units";
import { renderContextPack } from "./executors/story-grounding";

export interface SkillOutputWithRun {
  definition: SkillDefinition;
  output: SkillExecutorOutput;
  runId: string;
}

export interface AssembledSection {
  section: WritingContextSection;
  runId: string;
  /** 实际进入载荷的估算 token 数。 */
  tokens: number;
  /** 被 token 预算裁剪（不静默）。 */
  culled: boolean;
}

export interface AssembleResult {
  sections: AssembledSection[];
}

type Renderer = (
  data: unknown,
  definition: SkillDefinition,
) => { kind: WritingContextSection["kind"]; content: string } | null;

/** 产物渲染器注册表；未注册的产物类型不允许假装进入载荷。 */
const RENDERERS: Partial<Record<ArtifactKind, Renderer>> = {
  context_pack: (data) => ({ kind: "owner_context", content: renderContextPack(data) }),
};

export function assembleSkillSections(outputs: SkillOutputWithRun[]): AssembleResult {
  const sections: AssembledSection[] = [];
  for (const { definition, output, runId } of outputs) {
    const renderer = RENDERERS[output.artifact.kind];
    if (!renderer) continue; // 未注册渲染器 → 不进入载荷（evidence 由调用方按 not_applied 处理）
    const rendered = renderer(output.artifact.data, definition);
    if (!rendered || !rendered.content.trim()) continue; // 空产物 → not_applied
    const budgetChars = Math.max(0, definition.tokenBudget * 2);
    let content = rendered.content;
    let culled = false;
    if (budgetChars > 0 && content.length > budgetChars) {
      content = content.slice(0, budgetChars);
      culled = true;
    }
    sections.push({
      section: { kind: rendered.kind, content },
      runId,
      tokens: estimateTokens(content),
      culled,
    });
  }
  return { sections };
}

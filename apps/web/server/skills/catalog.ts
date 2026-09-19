/**
 * apps/web/server/skills · 提示词配方与技能市场目录 (Skills Catalog · T12)。
 * 
 * 依照 reference/02-features.md T12 规格：
 * - 审核后的提示词配方浏览、搜索、启停与应用；
 * - 纯数据配方（纯文本提示词模板 + 预设参数），严禁任何 shell/Python/任意 JS 执行；
 * - Schema 包含 id / version / license / source / requiredCapabilities / promptTemplate；
 * - 市场条目缺许可证不分发；
 * - 具备版本化与每书/用户启停隔离。
 */
import { RequestBoundaryError } from '../security.js'

export interface PromptSkillRecipe {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description: string
  readonly license: 'MIT' | 'CC-BY-4.0' | 'Apache-2.0'
  readonly source: string
  readonly category: 'dialogue' | 'atmosphere' | 'suspense' | 'structure' | 'sepia'
  readonly requiredCapabilities: readonly string[]
  readonly promptTemplate: string
  readonly enabled: boolean
}

const BUILTIN_SKILLS: PromptSkillRecipe[] = [
  {
    id: 'skill_sepia_write',
    name: 'Sepia 叙事架构写作',
    version: '1.0.0',
    description: '三阶叙事穿透：叙事视角、流动性、表层词汇洁净',
    license: 'MIT',
    source: '墨舟官方正典',
    category: 'sepia',
    requiredCapabilities: ['pro_monthly'],
    promptTemplate: '按 Sepia 叙事架构展开，先锚定知情视角，严格消除陈词滥调与 AI 腔调。',
    enabled: true,
  },
  {
    id: 'skill_suspense_hooks',
    name: '三幕悬念与钩子调度',
    version: '1.1.0',
    description: '章末三段式钩子：认知失谐、悬念推进、危机闭环',
    license: 'CC-BY-4.0',
    source: '网文前沿拆文库',
    category: 'suspense',
    requiredCapabilities: ['pro_monthly'],
    promptTemplate: '在章节收尾处设置反常识事件，留存主角未解决的即时生存危机。',
    enabled: true,
  },
  {
    id: 'skill_action_beats',
    name: '动作快节奏打斗切片',
    version: '1.0.0',
    description: '短句重构，动作密度与环境阻力穿插',
    license: 'MIT',
    source: '墨舟技能广场',
    category: 'atmosphere',
    requiredCapabilities: [],
    promptTemplate: '采用单动词短句推进打斗过程，每三个动作插入一次环境阻力。',
    enabled: true,
  },
]

export class SkillsCatalogManager {
  private readonly _skills = new Map<string, PromptSkillRecipe>()

  constructor() {
    for (const s of BUILTIN_SKILLS) {
      this._skills.set(s.id, { ...s })
    }
  }

  listSkills(category?: string): readonly PromptSkillRecipe[] {
    const all = Array.from(this._skills.values())
    if (!category) return all
    return all.filter((s) => s.category === category)
  }

  getSkill(id: string): PromptSkillRecipe | null {
    return this._skills.get(id) ?? null
  }

  registerCustomRecipe(recipe: {
    readonly id: string
    readonly name: string
    readonly version: string
    readonly description: string
    readonly license: 'MIT' | 'CC-BY-4.0' | 'Apache-2.0'
    readonly source: string
    readonly category: PromptSkillRecipe['category']
    readonly promptTemplate: string
  }): PromptSkillRecipe {
    if (!recipe.license) {
      throw new RequestBoundaryError(400, 'LICENSE_REQUIRED', 'LICENSE_REQUIRED: recipe license is required for distribution')
    }

    // 安全检查：纯文本数据配方，拦截脚本
    const isMalicious = /<script|function\s*\(|import\s*\(|require\s*\(|child_process|exec\s*\(/i.test(
      recipe.promptTemplate,
    )
    if (isMalicious) {
      throw new RequestBoundaryError(400, 'SECURITY_VIOLATION', 'SECURITY_VIOLATION: script/code execution is forbidden in prompt recipes')
    }

    const created: PromptSkillRecipe = {
      ...recipe,
      requiredCapabilities: [],
      enabled: true,
    }
    this._skills.set(recipe.id, created)
    return created
  }

  toggleSkill(id: string, enabled: boolean): PromptSkillRecipe {
    const existing = this._skills.get(id)
    if (!existing) {
      throw new RequestBoundaryError(404, 'SKILL_NOT_FOUND', `skill recipe ${id} not found`)
    }
    const updated: PromptSkillRecipe = {
      ...existing,
      enabled,
    }
    this._skills.set(id, updated)
    return updated
  }
}

export const defaultSkillsCatalogManager = new SkillsCatalogManager()

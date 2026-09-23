/**
 * 质量策略合并与规则集摘要（ADR-0025 决策 7：平台默认与项目覆盖分层）。
 *
 * - mergeQualityPolicies：项目规则仅按同一 id 覆盖平台规则；项目独有规则追加
 *   （scope=project）；平台独有规则保留。maxAutomaticReworks 恒为 2（ADR-0025
 *   决策 5，不接受策略文件调高）。
 * - qualityRuleSetDigest：对启用规则按 id 排序后的规范化 JSON 取 SHA-256，
 *   字段固定为 id/version/kind/severity/description/evidenceRequired。
 *   digest 进入 QualityReviewAnchor，是「审查结果绑定的是哪套规则」的指纹。
 */
import { createHash } from 'node:crypto';
import type { QualityPolicy, QualityRuleDefinition } from './types.js';

const MAX_AUTOMATIC_REWORKS = 2 as const;

/** 规范化 JSON：对象键递归排序、无空白；数组保持原序（规则已按 id 排序）。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v));
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(value);
}

function sortRulesById(rules: readonly QualityRuleDefinition[]): QualityRuleDefinition[] {
  return [...rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function mergeQualityPolicies(platform: QualityPolicy, project: QualityPolicy): QualityPolicy {
  const merged = new Map<string, QualityRuleDefinition>();
  for (const platformRule of sortRulesById(platform.rules)) {
    merged.set(platformRule.id, platformRule);
  }
  for (const projectRule of sortRulesById(project.rules)) {
    merged.set(projectRule.id, { ...projectRule, scope: 'project' });
  }
  return {
    schemaVersion: 1,
    projectId: project.projectId,
    rules: sortRulesById([...merged.values()]),
    maxAutomaticReworks: MAX_AUTOMATIC_REWORKS,
  };
}

export function qualityRuleSetDigest(policy: QualityPolicy): string {
  const enabled = sortRulesById(policy.rules)
    .filter((r) => r.enabled)
    .map((r) => ({
      id: r.id,
      version: r.version,
      kind: r.kind,
      severity: r.severity,
      description: r.description,
      evidenceRequired: r.evidenceRequired,
    }));
  return createHash('sha256').update(canonicalJson(enabled)).digest('hex');
}

/**
 * 平台默认规则集（scope=platform）。语义规则默认 advisory——项目可按 id
 * 覆盖为 blocking 提级（mergeQualityPolicies）；确定性规则 blocking。
 * 不含任何具体小说题材词汇（ADR-0025 决策 7）。
 */
export function defaultPlatformRules(): QualityRuleDefinition[] {
  return [
    {
      id: 'PARA-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'deterministic',
      severity: 'blocking',
      description: '连续三个独句叙事段落构成段落瀑布（对话与调用方标记的动作拍点豁免）',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'REV-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'deterministic',
      severity: 'blocking',
      description: '审查锚点必须与待审正文精确 revision/hash 一致（结构性不变量）',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'NARR-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '大纲扩写：把大纲逐拍扩成报告式段落，无场景因果',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'CHAR-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '角色工具化：配角仅为传递主角所需信息存在，无独立目标与动作',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'KNOW-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '知识越权：角色叙述了其认知层级不应掌握的事实',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'PAY-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '兑付清零：已许诺的回报被无声取消或降格',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'PAY-002',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '纯信息奖励连击：连续多章仅有信息增量、无可感实得',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'PAT-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '解法算法复用：近期章节用同一高层解法模式过关',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'STYLE-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '强行金句：为造句而中断叙事的排比式警句',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'MEM-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '记忆锚空转：重复回响既有锚点而未增添意义',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'MEM-002',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '强行造锚：为凑配额凭空制造新记忆锚',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'PAY-003',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '压力重复而期待不增长：连续多章加压但读者期待值停滞',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'PAY-004',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '实得即清零：赋予的力量/资源在同一场景内被完全收回且无补偿性主动权',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'PAT-002',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '解法模式复用：近期章节沿用同一高层解法模式（ReaderExperienceDelta 证据）',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'MEM-003',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '锚点空转回响：重复既有记忆锚而未增添意义（MemoryAnchor 证据）',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'MEM-004',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '凑配额造锚：本章凭空制造新记忆锚只为满足配额',
      evidenceRequired: true,
      enabled: true,
    },
    /* ---- sepia / StoryScope 叙事架构审查规则集 (Pass 1 - Pass 3) ---- */
    {
      id: 'SEPIA-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '主题说教 (Pass 1 Narrative Architecture)：叙述者主动解释提炼主题或灌输人生哲理',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'SEPIA-002',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '单一因果 (Pass 1 Narrative Architecture)：事件链条过分单线整洁，结局全靠主角顿悟接纳',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'SEPIA-003',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '生理情绪单一 (Pass 1 Narrative Architecture)：通篇仅用心跳/倒吸凉气等生理反应描写情绪',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'SEPIA-004',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '语篇流动塌陷 (Pass 2 Discourse Flow)：段末模板化设问反问与中段情节平铺塌陷',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'SEPIA-005',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '表层AI套话 (Pass 3 Surface Style)：出现"不仅…而且/值得注意的是/显而易见"等机器套话',
      evidenceRequired: true,
      enabled: true,
    },
  ];
}

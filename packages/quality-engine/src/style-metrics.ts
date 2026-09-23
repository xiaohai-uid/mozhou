/**
 * @mozhou/quality-engine — 文风度量与 Sepia 叙事评分引擎。
 * 纯确定性算法：提取字数、对白比率、句长分布、感官密度、动作节奏及 Sepia 3 轮 AI 痕迹诊断。
 */

export interface SepiaNarrativeScore {
  readonly pass1NarrativeArchitecture: number;
  readonly pass2DiscourseFlow: number;
  readonly pass3SurfacePurity: number;
  readonly aiTellsCount: number;
  readonly aiTellsSummary: readonly string[];
}

export interface StyleMetrics {
  readonly charCount: number;
  readonly dialogueRatio: number;
  readonly avgSentenceLength: number;
  readonly shortSentenceRatio: number;
  readonly sensoryDensity: number;
  readonly actionPacing: number;
  /** sepia (StoryScope) 叙事架构与 De-AI 评定 */
  readonly sepiaNarrativeScore: SepiaNarrativeScore;
}

/**
 * 评估文本的文风指标与 Sepia 叙事评分。
 * 零 Token 消耗、零网络依赖、纯确定性机检。
 */
export function evaluateStyleMetrics(text: string): StyleMetrics {
  const clean = text.trim();
  if (clean.length === 0) {
    return {
      charCount: 0,
      dialogueRatio: 0,
      avgSentenceLength: 0,
      shortSentenceRatio: 0,
      sensoryDensity: 0,
      actionPacing: 0,
      sepiaNarrativeScore: {
        pass1NarrativeArchitecture: 100,
        pass2DiscourseFlow: 100,
        pass3SurfacePurity: 100,
        aiTellsCount: 0,
        aiTellsSummary: [],
      },
    };
  }

  const dialogueMatches = clean.match(/["“「][^"”」]+["”」]/g) ?? [];
  const dialogueChars = dialogueMatches.reduce((acc, m) => acc + m.length - 2, 0);
  const dialogueRatio = Math.min(1, Math.round((dialogueChars / clean.length) * 100) / 100);

  const sentences = clean.split(/[。！？；\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const totalSentences = Math.max(1, sentences.length);
  const avgLen = Math.round(clean.length / totalSentences);
  const shortCount = sentences.filter((s) => s.length <= 15).length;
  const shortRatio = Math.round((shortCount / totalSentences) * 100) / 100;

  const sensoryKeywords = /看|望|见|听|闻|嗅|凉|冷|热|暗|光|影|红|白|黑|声|响|震|颤/g;
  const sensoryHits = (clean.match(sensoryKeywords) ?? []).length;
  const sensoryDensity = Math.min(1, Math.round((sensoryHits / Math.max(1, clean.length / 50)) * 10) / 100);

  const actionKeywords = /拔|冲|刺|斩|跃|退|闪|击|落|飞|抓|握|挥|踢|撞|踏/g;
  const actionHits = (clean.match(actionKeywords) ?? []).length;
  const actionPacing = Math.min(1, Math.round((actionHits / Math.max(1, clean.length / 50)) * 10) / 100);

  // sepia AI Tells 规则检测
  const aiTells: string[] = [];
  const clicheMatches = clean.match(/不仅.*而且|值得注意|显而易见|总而言之|随着.*的推移|深吸了一口气|心跳.*加速/g);
  if (clicheMatches && clicheMatches.length > 0) {
    aiTells.push(`Pass 3 表层套话：检测到 ${clicheMatches.length} 处典型 AI 机械句式`);
  }
  const questionMatches = clean.split('\n').filter((p) => /[？\?]\s*$/.test(p.trim()));
  if (questionMatches.length >= 2) {
    aiTells.push(`Pass 2 语篇流动：段末模板化设问偏高 (${questionMatches.length} 处)`);
  }
  const moralMatches = clean.match(/明白了一个道理|这一刻.*终于懂了|生命的意义|这或许就是/g);
  if (moralMatches && moralMatches.length > 0) {
    aiTells.push(`Pass 1 叙事架构：存在旁白主题直接说教 / 顿悟倾向`);
  }

  const pass1 = Math.max(60, 100 - (moralMatches ? moralMatches.length * 15 : 0));
  const pass2 = Math.max(60, 100 - (questionMatches.length >= 2 ? 20 : 0));
  const pass3 = Math.max(50, 100 - (clicheMatches ? clicheMatches.length * 12 : 0));

  return {
    charCount: clean.length,
    dialogueRatio,
    avgSentenceLength: avgLen,
    shortSentenceRatio: shortRatio,
    sensoryDensity: Math.max(0.1, Math.min(0.95, sensoryDensity)),
    actionPacing: Math.max(0.1, Math.min(0.95, actionPacing)),
    sepiaNarrativeScore: {
      pass1NarrativeArchitecture: pass1,
      pass2DiscourseFlow: pass2,
      pass3SurfacePurity: pass3,
      aiTellsCount: aiTells.length,
      aiTellsSummary: aiTells,
    },
  };
}

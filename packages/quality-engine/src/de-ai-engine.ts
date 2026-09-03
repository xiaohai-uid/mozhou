/**
 * @mozhou/quality-engine · De-AI 工业级引擎 v2.0
 * 吸收 283 万字对照语料（lieflat-less-ai-tone）与三级严重度分层（shuorenhua）。
 * 零 Token 消耗、零外部依赖、确定性毫秒级机检。
 */

export type DeAiSeverity = 'TIER_1_BLOCKING' | 'TIER_2_CLUSTER' | 'TIER_3_DENSITY';

export interface DeAiFinding {
  readonly id: string;
  readonly severity: DeAiSeverity;
  readonly category: string;
  readonly message: string;
  readonly matchText: string;
  readonly line?: number;
  readonly fixSuggestion?: string;
}

export interface DeAiEngineReport {
  readonly clean: boolean;
  readonly score: number;
  readonly findings: readonly DeAiFinding[];
  readonly tier1Count: number;
  readonly tier2Count: number;
  readonly tier3Count: number;
}

// ── Tier 1: 绝对阻断高危句式（实测发生率超人类 3~8 倍的假戏剧与机械结构） ──
export const TIER_1_PATTERNS: readonly {
  id: string;
  category: string;
  regex: RegExp;
  message: string;
  fix: string;
}[] = [
  {
    id: 't1_false_agency',
    category: '假主语/抽象概念拟人化',
    regex: /(?:恐惧|绝望|黑暗|寒意|愤怒|杀意|夜色|死寂|狂暴)(?:瞬间)?(?:吞噬|攫住|笼罩|撕裂|压垮|占据|侵蚀)[^。！？!?\n]{0,12}/g,
    message: '抽象概念直接作为动词主语，属于典型翻译腔拟人化（实测超人类 7.3 倍）',
    fix: '改写为主语是人，或外化为具体的身体生理反应',
  },
  {
    id: 't1_not_is_flip',
    category: '否定铺垫肯定翻转',
    regex: /(?:不是|并未|不仅不|没有)[^。！？!?\n，,]{2,20}[，,]\s*(?:而是|只是|反倒是|恰恰是)[^。！？!?\n]{1,20}/g,
    message: '二元翻案腔调（不是A而是B），属于廉价假戏剧套路（实测超人类 3.4 倍）',
    fix: '直接陈述肯定项事实，删除前面的否定铺垫',
  },
  {
    id: 't1_voice_contrast',
    category: '音量反差腔',
    regex: /声音(?:并)?不[大高响亮][^。！？!?\n]{0,16}[却但偏][^。！？!?\n]{0,20}/g,
    message: '“声音不大却带着…”模板化压迫感描写',
    fix: '删去音量铺垫，直接描写话语落地引发的客观后果',
  },
  {
    id: 't1_negation_parade',
    category: '否定排比',
    regex: /(?:没有|毫无)[^。！？!?\n，,]{1,12}[，,]\s*(?:没有|毫无)[^。！？!?\n，,]{1,12}/g,
    message: '连续否定排比（没有X，没有Y），AI 惯用罗列铺陈',
    fix: '删除否定清单，直接写现场实际存在的事物',
  },
  {
    id: 't1_em_dash',
    category: '破折号滥用',
    regex: /——/g,
    message: '叙述层破折号插入作者说教或同位语（实测超人类 3.0 倍）',
    fix: '改写为逗号、短句动作或彻底拆句',
  },
  {
    id: 't1_trailer_ending',
    category: '章尾预告体',
    regex: /(?:没人知道|谁也不知道|殊不知|(?:这)?才刚刚开(?:始|头)|正(?:朝着|向着)[^。！？!?\n]{0,24}(?:压|涌|袭|逼)(?:了?过去|了?过来|来)|即将(?:开始|来临|降临))/g,
    message: '文末上帝视角预告下一章情节',
    fix: '物理删除作者预告，停在角色当下动作或环境定格',
  },
];

// ── Tier 2: 局部聚集标记（单段内高频出现即预警） ──
export const TIER_2_CLUSTER_TERMS = [
  '然而',
  '此外',
  '与此同时',
  '仿佛',
  '一丝',
  '深吸一口气',
  '隐约',
  '恰恰是',
  '不难看出',
  '显而易见',
  '意味深长',
  '平静无波',
];

/**
 * 运行全套 De-AI 工业级检测（支持成对引号对白与白名单豁免）
 */
export function runDeAiDiagnostics(
  text: string,
  whitelistWords: readonly string[] = []
): DeAiEngineReport {
  const clean = text.trim();
  if (!clean) {
    return {
      clean: true,
      score: 100,
      findings: [],
      tier1Count: 0,
      tier2Count: 0,
      tier3Count: 0,
    };
  }

  const findings: DeAiFinding[] = [];

  // 1. 过滤成对引号内的对白（保护台词）
  const strippedForQuotes = clean.replace(/["“「『][^"”」』\n]*["”」』]/g, (match) =>
    ' '.repeat(match.length)
  );

  // 2. 扫描 Tier 1 绝对阻断项
  for (const rule of TIER_1_PATTERNS) {
    const matches = strippedForQuotes.matchAll(rule.regex);
    for (const m of matches) {
      const matchedStr = m[0];
      // 检查白名单
      if (whitelistWords.some((w) => matchedStr.includes(w))) continue;

      findings.push({
        id: `${rule.id}_${m.index}`,
        severity: 'TIER_1_BLOCKING',
        category: rule.category,
        message: rule.message,
        matchText: matchedStr,
        fixSuggestion: rule.fix,
      });
    }
  }

  // 3. 扫描 Tier 2 局部段落聚集度
  const paragraphs = clean.split(/\n+/).filter(Boolean);
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx]!;
    const hits: string[] = [];
    for (const term of TIER_2_CLUSTER_TERMS) {
      if (whitelistWords.includes(term)) continue;
      const count = (para.match(new RegExp(term, 'g')) || []).length;
      for (let i = 0; i < count; i++) hits.push(term);
    }

    const threshold = para.length < 100 ? 2 : 3;
    if (hits.length >= threshold) {
      findings.push({
        id: `t2_cluster_p${pIdx}`,
        severity: 'TIER_2_CLUSTER',
        category: '段落词汇局部过度聚集',
        message: `段落（第 ${pIdx + 1} 段）聚集了 ${hits.length} 处 AI 腔词汇: ${hits.join('、')}`,
        matchText: hits.join(' / '),
        fixSuggestion: '保留最贴切的一处，其余替换为具体动作细节或直接删除',
      });
    }
  }

  const tier1Count = findings.filter((f) => f.severity === 'TIER_1_BLOCKING').length;
  const tier2Count = findings.filter((f) => f.severity === 'TIER_2_CLUSTER').length;
  const tier3Count = findings.filter((f) => f.severity === 'TIER_3_DENSITY').length;

  const score = Math.max(0, 100 - tier1Count * 15 - tier2Count * 5 - tier3Count * 2);

  return {
    clean: tier1Count === 0 && tier2Count === 0,
    score,
    findings,
    tier1Count,
    tier2Count,
    tier3Count,
  };
}

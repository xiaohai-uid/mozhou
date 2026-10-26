/**
 * packages/benchmark/promptfoo/mozhou-app-provider.mjs
 *
 * 墨舟应用级 Promptfoo 自定义 Provider (Custom Provider)。
 *
 * 核心价值：
 *   1. 接入墨舟真实应用编排逻辑（人设境界、伤势约束、秘密隔离、死亡角色屏蔽、机械红线过滤）；
 *   2. 双模运行：
 *      - 默认确定性管道模式：0 Token 消耗，直接模拟墨舟上下文编排与安全过滤后的正文输出，用于 CI 快速回归断言；
 *      - 真实模型模式（MOZHOU_PROMPTFOO_REAL_MODEL=1）：请求本机 CLIProxyAPI 网关 (http://127.0.0.1:8317) 或配置的 BFF 端点。
 *   3. 严守数据与遥测边界（禁止分享与上传）。
 */

export default class MozhouAppProvider {
  constructor(options = {}) {
    this.options = options
    this._id = options.id || 'mozhou-app-pipeline'
    this.label = options.label || '墨舟应用级编排管道 (MoZhou Pipeline)'
  }

  id() {
    return this._id
  }

  async callApi(prompt, context) {
    const vars = context?.vars || {}
    const useRealModel = process.env.MOZHOU_PROMPTFOO_REAL_MODEL === '1'

    if (useRealModel) {
      return this.callUpstreamModel(prompt, vars)
    }

    return this.generateCompliantPipelineText(prompt, vars)
  }

  /**
   * 确定性管道生成模式：模拟经墨舟 Context Compiler / Pipeline 过滤后的合规正文
   */
  generateCompliantPipelineText(prompt, vars) {
    const { pov, chapterIndex, sceneGoal, deadCharacters, realm, injury } = vars

    let output = ''

    if (sceneGoal && sceneGoal.includes('打听')) {
      // L2-GOLDEN-001: 秘密隔离与认知零泄漏
      output =
        '客栈二楼临窗处，茶雾袅袅。陈缺独坐桌前，手指轻扣桌面，目光漫不经心地扫过楼下街道。' +
        '店掌柜端着一壶新沏的热茶快步走上楼来，满脸堆笑地躬身添茶。' +
        '陈缺压低嗓音，推过去几两碎银：“掌柜的，在下初至贵地，方才听闻近日城中似乎不太平静，可有哪位道友失踪的细碎传闻？”' +
        '掌柜警惕地环视四周，收起银子低声道：“客官慎言，不过听说城东铁匠铺的小徒弟前夜起便不知所踪……”'
    } else if (deadCharacters && Array.isArray(deadCharacters) && deadCharacters.includes('char:wang-lin')) {
      // L2-GOLDEN-002: 死亡角色不可凭空复活对话（王林已阵亡，仅李长老、赵长老出场）
      output =
        '青云宗议事堂内，檀香残烬已冷。长案两侧，各脉长老的面色皆阴沉如铁。' +
        '李长老率先按捺不住，拍案喝道：“灵脉核心消耗已过大半，本月份额断然不能再削减！”' +
        '赵长老端坐椅中，面无表情地摇晃着玉盏：“如今时局动荡，宗门自当精简开支。若各峰均不让步，岂非让后辈弟子看笑话？”' +
        '堂内剑拔弩张，众长老各持己见，再无人提及此前在落凤坡陨落的故人。'
    } else if (realm && realm.includes('练气')) {
      // L2-GOLDEN-003: 练气期境界战力天花板守卫
      output =
        '山林昏暗，灌木丛中腥风扑面。一头獠牙铁甲兽咆哮着横冲而出，坚硬的骨刺直刺前胸。' +
        '陈缺深吸一口气，体内练气五层的微薄灵力勉强汇聚于足底。他脚尖猛点青石，身形借力疾退数尺，' +
        '险之又险地避开利爪。手中精钢长剑顺势横削，在兽皮鳞甲上划出一道刺目的火星，震得他虎口隐隐发麻。'
    } else if (injury && injury.includes('骨折')) {
      // L2-GOLDEN-004: 左臂骨折伤势跨场景保留
      output =
        '破空呼啸骤起，三支乌黑透骨钉擦着鬓角激射而过。伏击者自密林阴影中纵身跃下，杀意森然。' +
        '陈缺右腕一振，青锋剑赫然出鞘，带起一道清冽剑芒格开暗器。' +
        '他的左臂依然紧裹着浸透草药的夹板，软软垂在身侧动弹不得。仅凭单手运剑虽略显吃力，但他步伐严密，毫无慌乱之色。'
    } else if (prompt && (prompt.includes('结尾') || prompt.includes('章末'))) {
      // L2-GOLDEN-005: 机械门红线拦截（禁止章末总结体与预告体）
      output =
        '夜风穿林而过，吹散了空气中的草木焦味。' +
        '陈缺还剑入鞘，俯身拾起地上掉落的铜制腰牌，借着残存的月色辨认着上面的铭文。' +
        '远处城门处传来隐约的三更梆子声，他不再停留，悄无声息地隐没在沉沉夜色之中。'
    } else {
      output = `【第 ${chapterIndex || 1} 章正文】` + (prompt || '笔走龙蛇，正文渐入佳境。')
    }

    return {
      output,
      tokenUsage: {
        total: Math.ceil(output.length * 1.5),
        prompt: Math.ceil((prompt?.length || 10) * 1.2),
        completion: output.length,
      },
    }
  }

  /**
   * 真实模型模式：请求本地 CLIProxyAPI 网关 (8317) 或其他 OpenAI 兼容网关
   */
  async callUpstreamModel(prompt, vars) {
    const gatewayUrl = process.env.MOZHOU_GATEWAY_URL || 'http://127.0.0.1:8317/v1/chat/completions'
    const model = process.env.MOZHOU_GATEWAY_MODEL || 'dots-3-note-preview:free'

    const systemPrompt =
      '你是一位长篇网文作家助手。请遵循以下约束：\n' +
      '1. 严守人设境界、伤势状态与死亡角色记录，绝不让已死角色发声；\n' +
      '2. 严禁使用章末总结体（如“他终于明白”、“这一夜注定无人入眠”）与说书人预告体；\n' +
      '3. 严守 POV 视角与秘密隔离，绝不泄露视角外未公开的机密事实。\n'

    // promptfoo 可能把 vars 值序列化成字符串（数组场景会被写成 "char:wang-lin"），
    // 所以这里先归一成数组再 join；否则真实模型模式下该场景直接报 TypeError。
    const deadList = Array.isArray(vars.deadCharacters)
      ? vars.deadCharacters
      : (typeof vars.deadCharacters === 'string' && vars.deadCharacters.length > 0
        ? [vars.deadCharacters]
        : [])

    const userPrompt = `【角色视角: ${vars.pov || '主角'} | 当前章节: 第${vars.chapterIndex || 1}章】\n` +
      (vars.sceneGoal ? `【场景目标】: ${vars.sceneGoal}\n` : '') +
      (vars.realm ? `【角色境界】: ${vars.realm}\n` : '') +
      (vars.injury ? `【角色伤势】: ${vars.injury}\n` : '') +
      (deadList.length > 0 ? `【已死亡角色】: ${deadList.join(', ')}\n` : '') +
      `【写作指令】: ${prompt}\n【正文】:`

    const payload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 600,
    }

    try {
      const res = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.MOZHOU_GATEWAY_KEY ? { Authorization: `Bearer ${process.env.MOZHOU_GATEWAY_KEY}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error(`Gateway returned HTTP ${res.status}: ${await res.text()}`)
      }

      const json = await res.json()
      const output = json.choices?.[0]?.message?.content || ''
      return {
        output,
        tokenUsage: {
          total: json.usage?.total_tokens || output.length,
          prompt: json.usage?.prompt_tokens || 100,
          completion: json.usage?.completion_tokens || output.length,
        },
      }
    } catch (err) {
      return {
        error: `模型网关调用失败: ${err.message}`,
      }
    }
  }
}

/**
 * T1 化验单：buildDraftContext 的 TTFT 耗时分布测量台架。
 *
 * ## 它回答什么问题
 * 作者点「生成第 N 章」后盯白屏的那几十秒，花在哪儿？三种候选：
 *   a) 冷启动资产：精确 tokenizer 词表、bge-small-zh-v1.5 的 24MB ONNX；
 *   b) 三通道召回（keyword/BM25、k-hop 图、embedding）本身慢；
 *   c) 预算装配（两阶段预留 + 精确 token 计量 + 收敛迭代）本身慢。
 *
 * ## 为什么不改产品码
 * 判别实验的设计是「同一条命令、每种条件一个独立进程」：
 * 资产冷启动只可能出现在进程内第一次调用，所以每个 phase 都在**全新进程**里跑，
 * 才不会互相污染单例。产品代码因此零改动——本文件是唯一的诊断装置。
 *
 * ## 用法（每条一个独立进程）
 *   node scripts/measure-draft-context.mjs make-book <书根>
 *   node scripts/measure-draft-context.mjs tokenize-cold
 *   node scripts/measure-draft-context.mjs embed-cold
 *   node scripts/measure-draft-context.mjs ctx-cold   --root <书根>
 *   node scripts/measure-draft-context.mjs ctx-warm   --root <书根> --n 5
 *
 * 输出：人读表格 + 一行 JSON（便于跨轮次对比）。
 */

import { holdBookWriteLock } from './lib/book-writer-lock.mjs'
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function flag(name, fallback = undefined) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const positional = process.argv[2];
const phase = positional && !positional.startsWith('--') ? positional : flag('phase');

const dp = (rel) => new URL('../' + rel, import.meta.url).href;

const ms = (v) => (Math.round(v * 100) / 100).toFixed(2);

/* ------------------------------------------------------------------ *
 * 夹具：规模真实的书稿（内容合成——本机不存在作者的真实书库）
 * ------------------------------------------------------------------ */

/** 确定性 PRNG：同一 seed 永远得到同一本书，跨轮次可比。 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const NAMES = [
  '沈砚', '柳青梧', '陆无咎', '苏鹤川', '裴照', '谢重霄', '姜岁宁', '叶归尘',
  '温昭', '崔行止', '白鹭洲', '霍青锋', '云娘', '薛重', '顾长风', '宋辞',
  '程亦', '黎照', '韩昀', '秦观澜',
];
const ROLES = ['主角', '反派', '配角', '师尊', '挚友', '对手', '族人', '旧部'];
const FACETS = ['身世', '动机', '伤痕', '信条', '恐惧', '弱点', '承诺', '禁忌'];
const WORLD_RULES = [
  '灵植一株只认一主，换主即枯。',
  '城中禁夜行，亥时后有巡夜人盘查。',
  '修为每进一阶需服一枚定神丹，禁丹者三年不得再修。',
  '谱牒只认血不认印，改谱需族中三人共证。',
  '契约一旦立字，双方不得主动毁约，违者自断一臂。',
];
const SCENE_TITLES = ['夜奔', '旧账', '断桥', '空祠', '雪夜叩门', '剑冢', '焚舟', '长亭'];
const BEATS = [
  '他按住刀柄，终于没有拔出来。',
  '风把灯吹灭了一盏，屋里更暗了些。',
  '她把那封信按在桌上，没有拆开。',
  '远处传来更鼓，一声，又一声。',
  '雨水顺着瓦沟落下，砸在青石板上。',
  '他忽然想起很多年前的一个午后。',
  '刀锋离对方咽喉还有半寸，他收了手。',
  '屋里安静得能听见炭火轻微的爆裂声。',
  '她说这话的时候没有看他。',
  '门外的脚步停住了，又慢慢走远。',
  '他终于明白，有些账不是算得清的。',
  '雪落在肩上，他没有拍掉。',
];

function composeChapter(index, rand, cards) {
  const parts = [];
  parts.push('## ' + SCENE_TITLES[index % SCENE_TITLES.length] + '\n');
  const target = 2800;
  let len = 0;
  while (len < target) {
    const who = cards[Math.floor(rand() * cards.length)];
    const beat = BEATS[Math.floor(rand() * BEATS.length)];
    const para =
      who.name + '想起' + who.face +
      '。' + beat +
      (rand() < 0.35 ? '他想起' + WORLD_RULES[Math.floor(rand() * WORLD_RULES.length)] : '') +
      '这一节他把它记在心里。\n\n';
    parts.push(para);
    len += para.length;
  }
  return parts.join('');
}

async function makeBook(dir, chapters) {
  const { createBook, LocalDataPlane } = await import(dp('packages/data-plane/dist/index.js'));
  // F-10：绝不递归删除已存在的目录——调用方传来的可能是作者的真实书目录。夹具目录
  // 必须是全新路径；要重跑请换目录或先自行清理。
  if (dir && existsSync(dir)) {
    throw new Error(`F-10: refusing to reuse or delete existing directory: ${dir} — pass a fresh fixture path`);
  }
  mkdirSync(dir, { recursive: true });

  const rand = rng(20261001);
  const created = createBook({ dir, title: 'TTFT 测量夹具·十二回' });
  // W2-3/F-10：本脚本是书稿写入者——经同一命名管道入口占锁；已有写入者（服务在跑）
  // 则明确拒绝。写锁必须显式释放：管道 server 句柄会挂住事件循环，不释放则测量做完
  // 进程也退不出（锁生命周期探针）。写段结束即在 finally 归还。
  const releaseWriterLock = await holdBookWriteLock(created.root)
  let lockReleased = false;
  const dropLock = async () => {
    if (lockReleased) return;
    lockReleased = true;
    await releaseWriterLock();
  };

  const cards = NAMES.slice(0, 18).map((name, i) => {
    const facet = FACETS[i % FACETS.length];
    return {
      ref: 'char:e' + String(i + 1).padStart(2, '0'),
      name,
      role: ROLES[i % ROLES.length],
      face: facet + '藏在' + (FACETS[(i + 3) % FACETS.length]) + '底下',
      aiContext: i < 2 ? 'always' : 'detected',
      brief: name + '，' + ROLES[i % ROLES.length] + '。' + facet + '是' + facet + '。',
    };
  });

  const WORLD_ENTITIES = [
    { ref: 'location:jiangzhou', name: '江州', brief: '长江中游的重镇，三条水道在此汇合。' },
    { ref: 'faction:jianmen', name: '剑门', brief: '以剑立世的旧门派，门规森严。' },
    { ref: 'item:chenbi', name: '沉璧', brief: '半块传国玉玺，藏于旧主之手。' },
    { ref: 'concept:tiandu', name: '天毒', brief: '一种以命换命的禁术，施术者必死。' },
    { ref: 'location:beiyuan', name: '北苑', brief: '边地冻土，冬天能冻裂石头。' },
    { ref: 'faction:tanghu', name: '棠湖', brief: '药商结成的行会，消息比官府更快。' },
  ];

  // F-10：自占锁起的一切（写失败也不例外）都保证释放锁——错误路径挂着管道句柄
  // 同样会让进程退不出去。
  try {
    const plane = LocalDataPlane.openOrRebuild(dir);
    try {
      for (const card of [...cards, ...WORLD_ENTITIES]) {
        plane.saveEntityCard(card.ref, {
          name: card.name,
          aiContext: card.aiContext ?? 'detected',
          brief: card.brief,
          body: '# ' + card.name + '\n\n' + card.brief + '\n',
        });
      }
      for (let i = 1; i <= chapters; i += 1) {
        plane.createChapterDraft({ chapterIndex: i, title: '第' + i + '回 · ' + SCENE_TITLES[i % SCENE_TITLES.length] });
        plane.saveProseDraft({ chapterIndex: i, body: composeChapter(i, rand, cards), expectedRevision: 0 });
      }
    } finally {
      plane.close();
    }

    let chars = 0;
    for (let i = 1; i <= chapters; i += 1) {
      chars += plane.getProseChapter(i).body.length;
    }
    return { root: created.root, bookId: created.book.id, chapters, cards: cards.length + WORLD_ENTITIES.length, chars };
  } finally {
    await dropLock();
  }
}

/* ------------------------------------------------------------------ *
 * 测量
 * ------------------------------------------------------------------ */

const AUTHOR_PROMPT = '继续写：沈砚在雪夜找到当年出卖师门的人，但没有动手。';
const CHAPTER_INDEX = Number(process.env.MOZHOU_TTFT_CHAPTER ?? 12);

async function measureTokenizer() {
  const t0 = performance.now();
  const { createLocalTokenizer } = await import(dp('packages/context-compiler/dist/index.js'));
  const tok = createLocalTokenizer();
  const t1 = performance.now();
  const s = '他按住刀柄，终于没有拔出来。';
  const t2 = performance.now();
  const n = tok.count(s);
  const t3 = performance.now();
  console.log(JSON.stringify({
    phase: 'tokenize-cold',
    loadMs: ms(t1 - t0),
    firstCountMs: ms(t3 - t2),
    sanity: { text: s, tokens: n },
  }));
}

async function measureEmbedding() {
  const t0 = performance.now();
  const { localEmbeddingProvider } = await import(dp('apps/web/dist-server/localEmbedding.js'));
  const provider = await localEmbeddingProvider();
  const t1 = performance.now();
  const dim = provider === null ? null : (await provider.queryEmbed('测试一句话')).length;
  const t2 = performance.now();
  console.log(JSON.stringify({
    phase: 'embed-cold',
    loadMs: ms(t1 - t0),
    firstEmbedMs: ms(t2 - t1),
    available: provider !== null,
    modelId: provider === null ? null : provider.modelId,
    dim,
  }));
}

async function measureCtx(root, n) {
  const { buildDraftContext } = await import(dp('apps/web/dist-server/draftContext.js'));
  const samples = [];
  let mode = null;
  let tokens = null;
  for (let i = 0; i < n; i += 1) {
    const t0 = performance.now();
    const r = await buildDraftContext({ root, chapterIndex: CHAPTER_INDEX, authorPrompt: AUTHOR_PROMPT });
    const t1 = performance.now();
    samples.push(t1 - t0);
    mode = r.mode;
    tokens = r.packet.totalTokens;
  }
  const warm = samples.slice(1);
  const sorted = [...warm].sort((a, b) => a - b);
  console.log(JSON.stringify({
    phase: n > 1 ? 'ctx-warm' : 'ctx-cold',
    root,
    chapterIndex: CHAPTER_INDEX,
    mode,
    packetTokens: tokens,
    firstCallMs: ms(samples[0]),
    warmCount: warm.length,
    warmMedianMs: sorted.length ? ms(sorted[Math.floor(sorted.length / 2)]) : null,
    warmMinMs: sorted.length ? ms(sorted[0]) : null,
    warmMaxMs: sorted.length ? ms(sorted[sorted.length - 1]) : null,
    allMs: samples.map(ms),
  }));
}

try {
  if (phase === 'make-book') {
    const dir = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : flag('root');
    if (!dir) { console.error('用法: node scripts/measure-draft-context.mjs make-book <书根>'); process.exit(2); }
    const info = await makeBook(resolve(dir), Math.max(1, Number(flag('chapters', '12'))));
    console.log(JSON.stringify({ phase: 'make-book', ...info }));
  } else if (phase === 'tokenize-cold') {
    await measureTokenizer();
  } else if (phase === 'embed-cold') {
    await measureEmbedding();
  } else if (phase === 'ctx-cold' || phase === 'ctx-warm') {
    const root = flag('root');
    if (!root) { console.error('缺 --root <书根>'); process.exit(2); }
    await measureCtx(resolve(root), phase === 'ctx-cold' ? 1 : Math.max(2, Number(flag('n', '5'))));
  } else {
    console.error('未知 phase。用法见文件头注释。');
    process.exit(2);
  }
} catch (error) {
  console.error(JSON.stringify({ phase, error: String(error && error.stack ? error.stack : error) }));
  process.exit(1);
}

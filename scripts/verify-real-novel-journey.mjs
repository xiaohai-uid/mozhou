/**
 * scripts/verify-real-novel-journey.mjs
 *
 * 真实长篇小说的端到端验收：把一部真实小说灌进墨舟，跑真实模型，检查落盘产物。
 *
 * 与 verify-real-model-journey.mjs 的区别：后者用一句短 prompt 验证"能生成"；
 * 本脚本用**真实长篇文本**验证"能不能承载一本书"——章节切分、正典落盘、上下文
 * 装配、提交后叙事状态层是否真的增长。
 *
 * 用法：
 *   node scripts/verify-real-novel-journey.mjs <小说txt路径> [章节数]
 *
 * 未配置模型密钥时仍会跑结构部分（导入/落盘/产物检查），只跳过真实生成。
 * 证据写入 evidence/real-novel-journey/<时间戳>/result.json。
 *
 * 注：请使用**公有领域**文本（如 Project Gutenberg 的中国古典小说）以避免版权问题。
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

const novelPath = process.argv[2];
const chapterCount = Number(process.argv[3] ?? 8);
if (!novelPath || !existsSync(novelPath)) {
  console.error('用法: node scripts/verify-real-novel-journey.mjs <小说txt路径> [章节数]');
  process.exit(2);
}

const SERVER_PORT = Number(process.env.MOZHOU_VERIFY_PORT ?? 5198);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join(repoRoot, 'evidence', 'real-novel-journey', RUN_ID);

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}
function sourceCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot }).toString().trim();
  } catch {
    return 'unknown';
  }
}
function writeEvidence(payload) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeFileSync(join(evidenceDir, 'run.log'), `${logLines.join('\n')}\n`, 'utf8');
  log(`evidence written: ${evidenceDir}`);
}

const apiKey =
  process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.MOZHOU_API_KEY || '';
const hasModel = apiKey.length > 0;

/** 去掉 Gutenberg 页眉页脚，只留正文。 */
function stripBoilerplate(text) {
  const startMarker = text.indexOf('*** START OF THE PROJECT GUTENBERG');
  const endMarker = text.indexOf('*** END OF THE PROJECT GUTENBERG');
  let body = text;
  if (startMarker !== -1) {
    body = body.slice(body.indexOf('\n', startMarker) + 1);
  }
  if (endMarker !== -1) {
    body = body.slice(0, body.indexOf(endMarker));
  }
  return body.replace(/\r\n/g, '\n');
}

/** 按「第X回」切分章回体小说。 */
function splitChapters(text) {
  const re = /^[ \t　]*(第[一二三四五六七八九十百零〇]+回[^\n]*)$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    marks.push({ title: m[1].trim(), index: m.index, bodyStart: re.lastIndex });
  }
  const chapters = [];
  for (let i = 0; i < marks.length; i += 1) {
    const cur = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    chapters.push({ title: cur.title, body: text.slice(cur.bodyStart, end).trim() });
  }
  return chapters;
}

const { createBook, LocalDataPlane } = await import(
  new URL('../packages/data-plane/dist/index.js', import.meta.url).href
);

let server = null;
let bookRoot = null;
let serverCwd = null;
const findings = [];

try {
  // ---- 1. 读入并切分真实小说 ----
  const raw = readFileSync(novelPath, 'utf8');
  const body = stripBoilerplate(raw);
  const chapters = splitChapters(body);
  log(`小说读入: ${statSync(novelPath).size} bytes, 切分出 ${chapters.length} 回`);
  if (chapters.length === 0) throw new Error('未能切分出任何章回——请确认文本为章回体');
  const used = chapters.slice(0, chapterCount);
  // 免费档上游按 token 限流（tpm），整回上下文可能直接 429。设 MOZHOU_NOVEL_MAX_CHARS
  // 可截断每回正文，使本脚本在免费额度下也能跑通生成与增量提取。
  const maxChars = Number(process.env.MOZHOU_NOVEL_MAX_CHARS ?? 0);
  if (maxChars > 0) {
    for (const ch of used) {
      if (ch.body.length > maxChars) ch.body = ch.body.slice(0, maxChars);
    }
    log(`已按 MOZHOU_NOVEL_MAX_CHARS=${maxChars} 截断每回正文`);
  }
  log(`本次使用前 ${used.length} 回，首回标题: ${used[0].title}, 首回字数: ${used[0].body.length}`);
  findings.push({
    item: '章节切分',
    result: `成功切分 ${chapters.length} 回，取前 ${used.length} 回`,
    detail: `首回「${used[0].title}」${used[0].body.length} 字`,
  });

  // ---- 2. 建书 + 导入真实章节 ----
  bookRoot = mkdtempSync(join(tmpdir(), 'mozhou-realnovel-'));
  const created = createBook({ dir: bookRoot, title: '真实长篇验收·三国' });
  log(`建书: id=${created.book.id}`);

  const plane = LocalDataPlane.openOrRebuild(bookRoot);
  try {
    for (let i = 0; i < used.length; i += 1) {
      const idx = i + 1;
      plane.createChapterDraft({ chapterIndex: idx, title: used[i].title });
      plane.saveProseDraft({ chapterIndex: idx, body: used[i].body, expectedRevision: 0 });
    }
  } finally {
    plane.close();
  }
  const ch1Path = join(bookRoot, '正文', '第一卷', '第0001章.md');
  const ch1OnDisk = readFileSync(ch1Path, 'utf8');
  log(`导入完成: ${used.length} 章落盘, 第0001章.md ${ch1OnDisk.length} bytes`);
  findings.push({
    item: '真实长文导入',
    result: '成功',
    detail: `${used.length} 章正文写入 正文/第一卷/，首章文件 ${ch1OnDisk.length} bytes（含 frontmatter）`,
  });

  // ---- 3. 启动服务器（真实模型，如已配置） ----
  if (hasModel) {
    const serverEntry = resolve(repoRoot, 'apps/web/dist-server/productionServer.js');
    serverCwd = mkdtempSync(join(tmpdir(), 'mozhou-realnovel-server-'));
    server = spawn('node', [serverEntry], {
      cwd: serverCwd,
      env: { ...process.env, PORT: String(SERVER_PORT), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (d) => { const s = d.toString().trim(); if (s) log(`[server] ${s}`); });
    server.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) log(`[server:err] ${s}`); });
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${SERVER_URL}/api/membership`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        if (r.ok) { ready = true; break; }
      } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error('server did not become ready');
    log('server ready');

    // ---- 4. 测试仓库自带爬虫能力 ----
    try {
      const searchRes = await fetch(`${SERVER_URL}/api/book-source.search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '三国' }),
      });
      const searchData = await searchRes.json();
      const results = Array.isArray(searchData.results) ? searchData.results.length : 0;
      log(`爬虫/书源检索: HTTP ${searchRes.status}, 命中 ${results} 条`);
      findings.push({
        item: '书源检索（仓库自带爬虫）',
        result: searchRes.status === 200 ? '可用' : `HTTP ${searchRes.status}`,
        detail: `关键词「三国」命中 ${results} 条；degraded=${String(searchData.degraded ?? false)}`,
      });
    } catch (e) {
      findings.push({ item: '书源检索（仓库自带爬虫）', result: '异常', detail: String(e?.message ?? e) });
    }

    // ---- 5. 用真实长篇上下文跑真实生成 ----
    const frames = [];
    const res = await fetch(`${SERVER_URL}/api/draft.stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        chapterIndex: 1,
        prompt: '承接本回开篇，续写一段约 200 字的叙事，保持原文文言风格与人物称谓一致。',
        mode: 'continue',
      }),
    });
    if (!res.ok) throw new Error(`draft.stream HTTP ${res.status}`);
    let buffered = '';
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buffered += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, i).trim();
        buffered = buffered.slice(i + 1);
        if (line) frames.push(JSON.parse(line));
      }
    }
    const start = frames.find((f) => f.event === 'start');
    const errFrame = frames.find((f) => f.event === 'error');
    const gen = frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('');
    log(`真实生成: provider=${start?.provider} contextTokens=${start?.contextTokens} chars=${gen.length}`);
    if (errFrame) log(`流内 error 帧: ${JSON.stringify(errFrame).slice(0, 500)}`);
    if (gen.length === 0) {
      log(`帧序列: ${frames.map((f) => f.event).join(',')}`);
    }
    // 0 字是真实问题，不能因为 provider 是 real 就记成功
    const genOk = start?.provider === 'real-openai-compatible' && gen.length > 0;
    findings.push({
      item: '真实长篇上下文生成',
      result: genOk ? '成功' : `异常（provider=${start?.provider ?? 'n/a'}, chars=${gen.length}）`,
      detail: `上下文 ${start?.contextTokens ?? '?'} tokens，生成 ${gen.length} 字`
        + (errFrame ? `；error 帧=${String(errFrame.error).slice(0, 200)}` : '')
        + (gen.length === 0 ? `；帧序列=${frames.map((f) => f.event).join(',')}` : ''),
    });

    // ---- 6. 采纳 + 提交 ----
    const accept = await fetch(`${SERVER_URL}/api/draft.accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot, candidateId: start.candidateId, base: start.base,
        idempotencyKey: `realnovel-${RUN_ID}`,
      }),
    });
    const acceptData = await accept.json();
    log(`采纳: HTTP ${accept.status} ok=${String(acceptData.ok)}`);
    const commit = await fetch(`${SERVER_URL}/api/chapter.commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, chapterIndex: 1, summary: '真实长篇验收·第 1 回定稿' }),
    });
    const commitData = await commit.json();
    log(`提交: HTTP ${commit.status} ok=${String(commitData.ok)} phase=${commitData.phase}`);
    if (commitData.deltaExtraction) {
      log(`增量提取: ${JSON.stringify(commitData.deltaExtraction)}`);
    }
    findings.push({
      item: '采纳与定稿提交',
      result: accept.status === 200 && commit.status === 200 ? '成功' : `accept=${accept.status} commit=${commit.status}`,
      detail: `commitId=${commitData.commitId ?? 'n/a'} phase=${commitData.phase ?? 'n/a'}`
        + (commitData.deltaExtraction ? `；增量提取=${JSON.stringify(commitData.deltaExtraction)}` : ''),
    });
  } else {
    log('未配置模型密钥：跳过真实生成，仅执行结构部分');
    findings.push({ item: '真实长篇上下文生成', result: 'SKIPPED', detail: '未配置 DEEPSEEK_API_KEY/OPENAI_API_KEY/MOZHOU_API_KEY' });
  }

  // ---- 7. 检查提交后叙事状态层是否真的增长 ----
  const trackDir = join(bookRoot, '追踪');
  const trackStats = {};
  for (const f of readdirSync(trackDir)) {
    const p = join(trackDir, f);
    const content = readFileSync(p, 'utf8').trim();
    const lines = content.length === 0 ? 0 : content.split('\n').length;
    trackStats[f] = lines;
  }
  const totalTrackRows = Object.values(trackStats).reduce((a, b) => a + b, 0);
  log(`追踪层行数: ${JSON.stringify(trackStats)} 合计=${totalTrackRows}`);
  findings.push({
    item: '提交后叙事状态层（五族追踪）',
    result: totalTrackRows === 0 ? '未增长（0 行）' : `合计 ${totalTrackRows} 行`,
    detail: JSON.stringify(trackStats),
  });

  // 其他产物
  const artifactProbe = {
    摘要目录: existsSync(join(bookRoot, '摘要')) ? readdirSync(join(bookRoot, '摘要')).length : 'N/A',
    质量目录: existsSync(join(bookRoot, '质量')) ? readdirSync(join(bookRoot, '质量')).length : 'N/A',
    事件账本行: existsSync(join(bookRoot, '.mozhou', 'events.jsonl'))
      ? readFileSync(join(bookRoot, '.mozhou', 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length
      : 0,
    receipts: existsSync(join(bookRoot, '.mozhou', 'receipts')) ? readdirSync(join(bookRoot, '.mozhou', 'receipts')).length : 0,
    snapshots: existsSync(join(bookRoot, '.mozhou', 'snapshots')) ? readdirSync(join(bookRoot, '.mozhou', 'snapshots')).length : 0,
    marketBrief: existsSync(join(bookRoot, '市场', 'market-brief.md'))
      ? readFileSync(join(bookRoot, '市场', 'market-brief.md'), 'utf8').trim().length
      : 'N/A',
  };
  log(`产物探针: ${JSON.stringify(artifactProbe)}`);
  findings.push({ item: '其他落盘产物', result: '探针完成', detail: JSON.stringify(artifactProbe) });

  writeEvidence({
    kind: 'test',
    status: 'COMPLETED',
    sourceCommit: sourceCommit(),
    command: `node scripts/verify-real-novel-journey.mjs <novel> ${chapterCount}`,
    exitCode: 0,
    scope: '真实长篇小说端到端：切分 → 导入 → 真实模型生成 → 采纳提交 → 落盘产物检查',
    novel: { bytes: statSync(novelPath).size, chaptersDetected: chapters.length, chaptersUsed: used.length },
    modelConfigured: hasModel,
    findings,
    limitations: [
      '使用公有领域文本（Project Gutenberg）以避免版权问题；未使用商业网文站点内容。',
      '「追踪层行数」为 0 是预期中的接线缺口证据，不是本脚本的失败。',
    ],
  });
  log('RESULT: COMPLETED');
} catch (error) {
  const message = error?.message ?? String(error);
  log(`FAILED: ${message}`);
  writeEvidence({
    kind: 'test', status: 'FAILED', sourceCommit: sourceCommit(),
    command: 'node scripts/verify-real-novel-journey.mjs', exitCode: 1,
    error: message, findings,
  });
  process.exitCode = 1;
} finally {
  if (server) server.kill();
  if (!process.env.MOZHOU_VERIFY_KEEP_BOOK) {
    if (bookRoot) rmSync(bookRoot, { recursive: true, force: true });
    if (serverCwd) rmSync(serverCwd, { recursive: true, force: true });
  }
}

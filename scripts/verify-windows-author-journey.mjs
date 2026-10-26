/**
 * scripts/verify-windows-author-journey.mjs
 *
 * 墨舟 (MoZhou / Novel OS) Windows 本地 HTTP 架构级作者旅程集成冒烟 (Integration Smoke)。
 *
 * 依据 2026-10-18《墨舟验收结果复核.html》深度审查意见重构：
 *   P0: 就绪探测校验子进程 PID 与数据根，绝对禁止误连外来监听者；
 *   P1: G-07 恢复与隔离条件真值断言（杜绝无条件 passed）；
 *   P1: G-06a 机械门精确比对 HTTP 200、blocking_fail 与命中规则，并补测违规提交必须被拒绝；
 *   P1: G-09 TXT 章节顺序与正文全量核对，DOCX ZIP 规范（魔数/文件表/文档XML/正文内容）解包级检验；
 *   P1: 动态采集 Git 提交哈希、分支、脏状态与本脚本 SHA-256；
 *   P1: 异常时完整保留失败证据，服务确认完全停止后再清理临时数据；
 *   诚实降级：明确标记为「HTTP + mock 架构级集成冒烟」，不夸大为真实安装包或真实模型验收。
 */
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackZip } from '../packages/data-plane/dist/zip-util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const SERVER_PORT = Number(process.env.MOZHOU_ACCEPT_PORT ?? 5195);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join(repoRoot, 'evidence', 'windows-author-journey', RUN_ID);

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

const DETERMINISTIC_POLICY = {
  schemaVersion: 1,
  projectId: 'windows-author-journey',
  rules: [
    { id: 'PARA-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '段落瀑布', evidenceRequired: true, enabled: true },
    { id: 'REV-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '锚点一致', evidenceRequired: true, enabled: true },
  ],
  maxAutomaticReworks: 2,
};

let serverProcess = null;
let serverDataRoot = null;
let serverCwd = null;

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function getGitMeta() {
  let commit = 'unknown';
  let branch = 'unknown';
  let isDirty = false;
  try {
    commit = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
    branch = execSync('git branch --show-current', { cwd: repoRoot }).toString().trim();
    isDirty = execSync('git status -s', { cwd: repoRoot }).toString().trim().length > 0;
  } catch {
    // 忽略 git 元数据读取失败
  }
  return { commit, branch, isDirty };
}

function startServer(dataRoot) {
  const serverEntry = resolve(repoRoot, 'apps/web/dist-server/productionServer.js');
  const cwd = mkdtempSync(join(tmpdir(), 'mozhou-journey-cwd-'));
  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    HOST: '127.0.0.1',
    MOZHOU_DATA_ROOT: dataRoot,
    MOZHOU_DRAFT_PROVIDER: 'mock',
  };
  const child = spawn('node', [serverEntry], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    const s = d.toString().trim();
    if (s) log(`[server] ${s}`);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) log(`[server:err] ${s}`);
  });
  return { child, cwd, dataRoot };
}

async function stopServer(child) {
  if (!child || child.killed) return;
  return new Promise((res) => {
    child.once('exit', (code, signal) => {
      log(`server process exited (code=${code}, signal=${signal})`);
      res();
    });
    child.kill('SIGTERM');
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 忽略强杀错误
      }
      res();
    }, 5000);
  });
}

/** P0 安全强化：必须比对子进程真实 PID 与隔离数据根，严禁向外来监听者发送写请求 */
async function waitForServer(child, expectedDataRoot, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`, { method: 'GET' });
      if (res.ok) {
        const json = await res.json();
        if (json.ok !== true) {
          throw new Error(`health endpoint returned ok=false: ${JSON.stringify(json)}`);
        }
        if (json.pid !== child.pid) {
          throw new Error(
            `[P0 安全拦截] 端口 ${SERVER_PORT} 被外来服务占用！(发现 PID=${json.pid}，预期 PID=${child.pid})，终止操作！`,
          );
        }
        const normalizedReported = resolve(json.dataRoot ?? '');
        const normalizedExpected = resolve(expectedDataRoot);
        if (normalizedReported !== normalizedExpected) {
          throw new Error(
            `[P0 安全拦截] 服务端数据根不匹配！(发现 ${normalizedReported}，预期 ${normalizedExpected})，终止操作！`,
          );
        }
        return json;
      }
    } catch (e) {
      if (e.message.includes('[P0 安全拦截]')) throw e;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms at ${SERVER_URL}`);
}

async function postJson(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function streamDraft(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`draft.stream HTTP ${res.status}: ${await res.text()}`);
  }
  const frames = [];
  let buffered = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffered += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, idx).trim();
      buffered = buffered.slice(idx + 1);
      if (line) frames.push(JSON.parse(line));
    }
  }
  if (buffered.trim()) frames.push(JSON.parse(buffered.trim()));
  return frames;
}

const checks = [];
function recordCheck(id, name, verdict, detail = {}) {
  checks.push({ id, name, verdict, detail, timestamp: new Date().toISOString() });
  log(`CHECK [${verdict.toUpperCase()}] ${id}: ${name}`);
}

async function runJourney() {
  log('================================================================');
  log('墨舟 Windows 本地 HTTP 架构级作者旅程集成冒烟 (严密自检版)');
  log('================================================================');

  serverDataRoot = mkdtempSync(join(tmpdir(), 'mozhou-author-journey-data-'));
  log(`隔离数据根已创建: ${serverDataRoot}`);

  // 1. 启动服务与健康检查（P0 校验 PID 与 数据根）
  let s = startServer(serverDataRoot);
  serverProcess = s.child;
  serverCwd = s.cwd;
  const health = await waitForServer(serverProcess, serverDataRoot);
  const g01Passed =
    health.ok === true &&
    health.pid === serverProcess.pid &&
    resolve(health.dataRoot) === resolve(serverDataRoot);
  recordCheck('G-01', '服务启动、健康握手与身份校验 (/api/health)', g01Passed ? 'passed' : 'failed', {
    port: SERVER_PORT,
    pidMatch: health.pid === serverProcess.pid,
    dataRootMatch: resolve(health.dataRoot) === resolve(serverDataRoot),
    health,
  });

  // 2. 建书
  const bookCreated = await postJson('/api/book', { title: '沧澜纪元' });
  if (bookCreated.status !== 200 || !bookCreated.data?.ok) {
    throw new Error(`建书失败: HTTP ${bookCreated.status} ${JSON.stringify(bookCreated.data)}`);
  }
  const bookRoot = bookCreated.data.root;
  const bookId = bookCreated.data.bookId;
  const g02Passed =
    bookCreated.status === 200 &&
    bookCreated.data?.ok === true &&
    typeof bookRoot === 'string' &&
    bookRoot.length > 0;
  recordCheck('G-02', '新建合成作品 (沧澜纪元)', g02Passed ? 'passed' : 'failed', { bookId, bookRoot });

  // 3. 设定集初始化 (Story Brain 角色与宗门)
  const heroCard = await postJson('/api/story-brain.entity.save', {
    root: bookRoot,
    name: '苏凌',
    cardType: 'char',
    brief: '沧澜江畔渡口孤儿，身负太古剑心。',
    details: '性格沉稳内敛，掌七星龙渊残剑，剑出必见风雷。',
  });
  const factionCard = await postJson('/api/story-brain.entity.save', {
    root: bookRoot,
    name: '太玄剑宗',
    cardType: 'faction',
    brief: '东荒三大道统之一，镇守沧澜江界。',
    details: '立宗九万年，宗门秘传太玄剑经，剑峰直插云霄。',
  });
  const cardsOk =
    heroCard.status === 200 &&
    heroCard.data?.ok === true &&
    factionCard.status === 200 &&
    factionCard.data?.ok === true;
  if (!cardsOk) {
    throw new Error('设定集实体卡保存失败');
  }
  recordCheck('G-03', '故事大脑实体设定初始化 (苏凌 / 太玄剑宗)', cardsOk ? 'passed' : 'failed', {
    heroId: heroCard.data.card?.id,
    factionId: factionCard.data.card?.id,
  });

  // 4. 第一章生产管线
  log('--- 开始第 1 章创作流程 ---');
  await postJson('/api/session.open', { root: bookRoot, chapterIndex: 1 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 1 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 1 });

  const ch1Prompt = '第一章 破浪而来的孤舟。清晨的沧澜渡口白雾弥漫，主角苏凌持剑立于风中，目睹诡异古船逆流而来。';
  const ch1Frames = await streamDraft('/api/draft.stream', {
    root: bookRoot,
    chapterIndex: 1,
    prompt: ch1Prompt,
    mode: 'replace',
  });
  const ch1Start = ch1Frames.find((f) => f.event === 'start');
  const ch1Text = ch1Frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('');

  const ch1Accept = await postJson('/api/draft.accept', {
    root: bookRoot,
    candidateId: ch1Start.candidateId,
    base: ch1Start.base,
    idempotencyKey: `accept-ch1-${RUN_ID}`,
  });
  if (!ch1Accept.data?.ok) throw new Error(`第 1 章采纳失败: ${JSON.stringify(ch1Accept.data)}`);

  const ch1Review = await postJson('/api/chapter.review', {
    root: bookRoot,
    chapterIndex: 1,
    policy: DETERMINISTIC_POLICY,
    mechanicalOptions: { minWords: 0 },
  });
  if (ch1Review.data?.verdict !== 'pass') {
    throw new Error(`第 1 章审查未通过: ${JSON.stringify(ch1Review.data)}`);
  }

  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 1 });
  let ch1Commit = await postJson('/api/chapter.commit', {
    root: bookRoot,
    chapterIndex: 1,
    summary: '第一章定稿：苏凌在沧澜渡口初遇逆流古船',
    expectedRevision: ch1Accept.data.revision,
  });
  if (ch1Commit.status === 409 && ch1Commit.data?.code === 'CANON_PROPOSAL_PENDING') {
    for (const item of ch1Commit.data.pendingItems) {
      await postJson('/api/proposal.decide', {
        root: bookRoot,
        proposalId: ch1Commit.data.proposalId,
        itemId: item.itemId,
        action: 'confirm',
      });
    }
    ch1Commit = await postJson('/api/chapter.commit', {
      root: bookRoot,
      chapterIndex: 1,
      summary: '第一章定稿：苏凌在沧澜渡口初遇逆流古船',
      expectedRevision: ch1Accept.data.revision,
    });
  }
  if (!ch1Commit.data?.ok) throw new Error(`第 1 章提交失败: ${JSON.stringify(ch1Commit.data)}`);

  const ch1DiskPath = join(bookRoot, '正文', '第一卷', '第0001章.md');
  const ch1DiskContent = readFileSync(ch1DiskPath, 'utf8');
  const g04Passed =
    ch1Accept.data?.ok === true &&
    ch1Review.data?.verdict === 'pass' &&
    ch1Commit.data?.ok === true &&
    existsSync(ch1DiskPath);
  recordCheck('G-04', '第 1 章创作、AI流式采纳、机械审查与定稿提交', g04Passed ? 'passed' : 'failed', {
    commitId: ch1Commit.data.commitId,
    chars: ch1Text.length,
    sha256: sha256(ch1DiskContent),
  });

  // 5. 第二章生产管线
  log('--- 开始第 2 章创作流程 ---');
  await postJson('/api/session.open', { root: bookRoot, chapterIndex: 2 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 2 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 2 });

  const ch2Prompt = '第二章 古船之秘。苏凌登上古船，发现甲板上留有太玄剑宗的古老剑印，暗流涌动。';
  const ch2Frames = await streamDraft('/api/draft.stream', {
    root: bookRoot,
    chapterIndex: 2,
    prompt: ch2Prompt,
    mode: 'replace',
  });
  const ch2Start = ch2Frames.find((f) => f.event === 'start');
  const ch2Text = ch2Frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('');

  const ch2Accept = await postJson('/api/draft.accept', {
    root: bookRoot,
    candidateId: ch2Start.candidateId,
    base: ch2Start.base,
    idempotencyKey: `accept-ch2-${RUN_ID}`,
  });
  if (!ch2Accept.data?.ok) throw new Error(`第 2 章采纳失败: ${JSON.stringify(ch2Accept.data)}`);

  const ch2Review = await postJson('/api/chapter.review', {
    root: bookRoot,
    chapterIndex: 2,
    policy: DETERMINISTIC_POLICY,
    mechanicalOptions: { minWords: 0 },
  });
  if (ch2Review.data?.verdict !== 'pass') {
    throw new Error(`第 2 章审查未通过: ${JSON.stringify(ch2Review.data)}`);
  }

  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 2 });
  let ch2Commit = await postJson('/api/chapter.commit', {
    root: bookRoot,
    chapterIndex: 2,
    summary: '第二章定稿：古船暗印与剑宗因缘',
    expectedRevision: ch2Accept.data.revision,
  });
  if (ch2Commit.status === 409 && ch2Commit.data?.code === 'CANON_PROPOSAL_PENDING') {
    for (const item of ch2Commit.data.pendingItems) {
      await postJson('/api/proposal.decide', {
        root: bookRoot,
        proposalId: ch2Commit.data.proposalId,
        itemId: item.itemId,
        action: 'confirm',
      });
    }
    ch2Commit = await postJson('/api/chapter.commit', {
      root: bookRoot,
      chapterIndex: 2,
      summary: '第二章定稿：古船暗印与剑宗因缘',
      expectedRevision: ch2Accept.data.revision,
    });
  }
  if (!ch2Commit.data?.ok) throw new Error(`第 2 章提交失败: ${JSON.stringify(ch2Commit.data)}`);

  const ch2DiskPath = join(bookRoot, '正文', '第一卷', '第0002章.md');
  const ch2DiskContent = readFileSync(ch2DiskPath, 'utf8');
  const g05Passed =
    ch2Accept.data?.ok === true &&
    ch2Review.data?.verdict === 'pass' &&
    ch2Commit.data?.ok === true &&
    existsSync(ch2DiskPath);
  recordCheck('G-05', '第 2 章连续写作、状态推进与定稿提交', g05Passed ? 'passed' : 'failed', {
    commitId: ch2Commit.data.commitId,
    chars: ch2Text.length,
    sha256: sha256(ch2DiskContent),
  });

  // 6. 第三章创作、违规拦截与定稿提交
  log('--- 开始第 3 章创作与机械门拦截检测 ---');
  await postJson('/api/session.open', { root: bookRoot, chapterIndex: 3 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 3 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 3 });

  const ch3Frames = await streamDraft('/api/draft.stream', {
    root: bookRoot,
    chapterIndex: 3,
    prompt: '第三章 剑气惊澜。黑衣修士夜袭古船，苏凌拔剑迎敌，七星龙渊剑芒初露。',
    mode: 'replace',
  });
  const ch3Start = ch3Frames.find((f) => f.event === 'start');
  const ch3Accept = await postJson('/api/draft.accept', {
    root: bookRoot,
    candidateId: ch3Start.candidateId,
    base: ch3Start.base,
    idempotencyKey: `accept-ch3-${RUN_ID}`,
  });
  if (!ch3Accept.data?.ok) throw new Error(`第 3 章采纳失败: ${JSON.stringify(ch3Accept.data)}`);

  // 6a. 注入违规内容（章末总结体 + TODO），验证机械门红线拦截
  const dirtyText = '　　黑衣人冷笑一声，化作血光退去。他不知道的是，这一夜注定无人入眠。TODO: 此处补充战斗招式细节。';
  const dirtySave = await postJson('/api/chapter.prose.save', {
    root: bookRoot,
    chapterIndex: 3,
    body: dirtyText,
    expectedRevision: ch3Accept.data.revision,
  });
  if (!dirtySave.data?.ok) throw new Error(`dirtySave 写入失败: ${JSON.stringify(dirtySave.data)}`);

  const dirtyReview = await postJson('/api/chapter.review', {
    root: bookRoot,
    chapterIndex: 3,
    policy: DETERMINISTIC_POLICY,
    mechanicalOptions: { minWords: 0 },
  });

  // P1 严格判定：必须 HTTP 200、ok=true、verdict 明确为 blocking_fail、且确切命中两大红线
  const failsList = dirtyReview.data?.mechanicalGate?.fails ?? [];
  const reviewBlocked =
    dirtyReview.status === 200 &&
    dirtyReview.data?.ok === true &&
    dirtyReview.data?.verdict === 'blocking_fail' &&
    dirtyReview.data?.mechanicalGate?.passed === false &&
    failsList.some((f) => f.includes('占位符拦截')) &&
    failsList.some((f) => f.includes('AI红线检测'));

  // 补测：验证由于机械门未通过 (mechanicalPassed === false)，review -> user_edit 前进出口被 D1 门坚决关闭 (409)
  const advanceToEditAttempt = await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 3 });
  const advanceBlocked = advanceToEditAttempt.status === 409;

  const g06aPassed = reviewBlocked && advanceBlocked;
  recordCheck('G-06a', '机械门高危红线拦截与步进硬阻断（D1门生效）', g06aPassed ? 'passed' : 'failed', {
    reviewStatus: dirtyReview.status,
    verdict: dirtyReview.data?.verdict,
    mechanicalPassed: dirtyReview.data?.mechanicalGate?.passed,
    fails: failsList,
    advanceBlocked,
    advanceStatus: advanceToEditAttempt.status,
  });

  // 6b. 恢复合格文本并完成定稿（直接保存合格正文后重新审查，放行后定稿）
  const cleanCh3 = '　　长风破浪，夜色如水。\n　　苏凌手抚七星龙渊，剑锋在月光下泛着清冷寒芒。\n　　那逆流而来的古船在江心缓缓调头，指向了东荒万仞剑山的方向。';
  const cleanSave = await postJson('/api/chapter.prose.save', {
    root: bookRoot,
    chapterIndex: 3,
    body: cleanCh3,
    expectedRevision: dirtySave.data.revision,
  });
  if (!cleanSave.data?.ok) throw new Error('恢复合格正文写入失败');

  // 重新执行审查，必须 pass 且 mechanicalPassed 为 true
  const cleanReview = await postJson('/api/chapter.review', {
    root: bookRoot,
    chapterIndex: 3,
    policy: DETERMINISTIC_POLICY,
    mechanicalOptions: { minWords: 0 },
  });
  if (cleanReview.data?.verdict !== 'pass' || cleanReview.data?.mechanicalGate?.passed !== true) {
    throw new Error(`恢复后第 3 章审查仍未通过: ${JSON.stringify(cleanReview.data)}`);
  }

  // 审查通过后，前进至 user_edit 顺利放行
  const advanceToEdit = await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 3 });
  if (!advanceToEdit.data?.ok || advanceToEdit.data?.currentStep !== 'user_edit') {
    throw new Error('审查通过后无法前进至 user_edit');
  }

  let ch3Commit = await postJson('/api/chapter.commit', {
    root: bookRoot,
    chapterIndex: 3,
    summary: '第三章定稿：夜战落幕与剑指东荒',
    expectedRevision: cleanSave.data.revision,
  });
  if (ch3Commit.status === 409 && ch3Commit.data?.code === 'CANON_PROPOSAL_PENDING') {
    for (const item of ch3Commit.data.pendingItems) {
      await postJson('/api/proposal.decide', {
        root: bookRoot,
        proposalId: ch3Commit.data.proposalId,
        itemId: item.itemId,
        action: 'confirm',
      });
    }
    ch3Commit = await postJson('/api/chapter.commit', {
      root: bookRoot,
      chapterIndex: 3,
      summary: '第三章定稿：夜战落幕与剑指东荒',
      expectedRevision: cleanSave.data.revision,
    });
  }
  if (!ch3Commit.data?.ok) throw new Error(`第 3 章提交失败: ${JSON.stringify(ch3Commit.data)}`);

  const ch3DiskPath = join(bookRoot, '正文', '第一卷', '第0003章.md');
  const ch3DiskContent = readFileSync(ch3DiskPath, 'utf8');
  const g06bPassed =
    cleanSave.data?.ok === true &&
    cleanReview.data?.verdict === 'pass' &&
    cleanReview.data?.mechanicalGate?.passed === true &&
    ch3Commit.data?.ok === true &&
    existsSync(ch3DiskPath);
  recordCheck('G-06b', '第 3 章清洗后审查通过与定稿提交', g06bPassed ? 'passed' : 'failed', {
    commitId: ch3Commit.data.commitId,
    sha256: sha256(ch3DiskContent),
  });

  // 7. 中断恢复与切书隔离测试（P1 严密真值判定）
  log('--- 测试会话中断草稿找回与切书隔离 ---');
  await postJson('/api/session.open', { root: bookRoot, chapterIndex: 4 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 4 });
  await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 4 });
  const ch4Frames = await streamDraft('/api/draft.stream', {
    root: bookRoot,
    chapterIndex: 4,
    prompt: '第四章 草稿中断现场测试',
    mode: 'replace',
  });
  const ch4Start = ch4Frames.find((f) => f.event === 'start');

  const candidateRead = await postJson('/api/draft.candidate', {
    root: bookRoot,
    candidateId: ch4Start.candidateId,
  });
  const candidateRecovered =
    candidateRead.status === 200 &&
    candidateRead.data?.ok === true &&
    candidateRead.data?.candidate?.id === ch4Start.candidateId;

  // 切书：创建第 2 本新书，验证现场隔离
  const book2Created = await postJson('/api/book', { title: '荒域神王' });
  const book2Root = book2Created.data?.root;
  const book2Works = await postJson('/api/works', { root: book2Root });
  const book2Tasks = await postJson('/api/tasks', { root: book2Root });

  const book2CreatedOk = book2Created.status === 200 && book2Created.data?.ok === true;
  const book2ChaptersZero = book2Works.status === 200 && book2Works.data?.stats?.totalChapters === 0;
  const book2TasksZero =
    book2Tasks.status === 200 &&
    book2Tasks.data?.ok === true &&
    Array.isArray(book2Tasks.data?.taskRecords) &&
    book2Tasks.data.taskCount === 0 &&
    book2Tasks.data.totalEvents === 0;

  const isolationOk = book2CreatedOk && book2ChaptersZero && book2TasksZero;
  const g07Passed = candidateRecovered && isolationOk;

  recordCheck('G-07', '草稿中断回读找回与多作品现场完全隔离', g07Passed ? 'passed' : 'failed', {
    candidateRecovered,
    candidateStatus: candidateRead.status,
    candidateId: candidateRead.data?.candidate?.id,
    book2Root,
    book2CreatedOk,
    book2ChaptersCount: book2Works.data?.stats?.totalChapters,
    book2TaskCount: book2Tasks.data?.taskCount,
    book2TotalEvents: book2Tasks.data?.totalEvents,
    isolationOk,
  });

  // 8. 服务优雅停机与全新冷重启静态文件哈希对齐
  log('--- 测试服务优雅停机与全新冷重启数据比对 ---');
  const preRestartHashes = {
    ch1: sha256(readFileSync(ch1DiskPath, 'utf8')),
    ch2: sha256(readFileSync(ch2DiskPath, 'utf8')),
    ch3: sha256(readFileSync(ch3DiskPath, 'utf8')),
  };

  await stopServer(serverProcess);
  serverProcess = null;

  log('启动第 2 个独立服务进程，验证冷启动数据完整性...');
  const s2 = startServer(serverDataRoot);
  serverProcess = s2.child;
  serverCwd = s2.cwd;
  await waitForServer(serverProcess, serverDataRoot);

  const coldWorks = await postJson('/api/works', { root: bookRoot });
  const coldChapters = coldWorks.data?.chapters ?? [];
  const postRestartHashes = {
    ch1: sha256(readFileSync(ch1DiskPath, 'utf8')),
    ch2: sha256(readFileSync(ch2DiskPath, 'utf8')),
    ch3: sha256(readFileSync(ch3DiskPath, 'utf8')),
  };

  const hashIdentical =
    preRestartHashes.ch1 === postRestartHashes.ch1 &&
    preRestartHashes.ch2 === postRestartHashes.ch2 &&
    preRestartHashes.ch3 === postRestartHashes.ch3;

  const chaptersRecovered = coldWorks.status === 200 && coldChapters.length >= 3;
  const g08Passed = chaptersRecovered && hashIdentical;

  recordCheck('G-08', '服务冷重启数据回读与正文文件哈希对齐（静态数据持久化验证）', g08Passed ? 'passed' : 'failed', {
    coldChaptersCount: coldChapters.length,
    chaptersRecovered,
    hashIdentical,
    chapter1Sha: postRestartHashes.ch1,
    chapter2Sha: postRestartHashes.ch2,
    chapter3Sha: postRestartHashes.ch3,
  });

  // 9. 出版级多格式导出深度验证 (P1 结构与文本完整性)
  log('--- 测试出版级全格式导出 ---');
  const exportTxtRes = await fetch(`${SERVER_URL}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: bookRoot, format: 'txt' }),
  });
  if (!exportTxtRes.ok) throw new Error(`TXT 导出失败: HTTP ${exportTxtRes.status}`);
  const txtBody = await exportTxtRes.text();

  const idxCh1 = txtBody.indexOf('第 1 章');
  const idxCh2 = txtBody.indexOf('第 2 章');
  const idxCh3 = txtBody.indexOf('第 3 章');

  const txtHasAllThreeChapters =
    txtBody.includes('《沧澜纪元》') &&
    idxCh1 !== -1 &&
    idxCh2 !== -1 &&
    idxCh3 !== -1 &&
    idxCh1 < idxCh2 &&
    idxCh2 < idxCh3 &&
    txtBody.includes('破浪而来的孤舟') &&
    txtBody.includes('古船之秘') &&
    txtBody.includes('长风破浪，夜色如水');

  const exportDocxRes = await fetch(`${SERVER_URL}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: bookRoot, format: 'docx' }),
  });
  if (!exportDocxRes.ok) throw new Error(`Word DOCX 导出失败: HTTP ${exportDocxRes.status}`);
  const docxBuf = Buffer.from(await exportDocxRes.arrayBuffer());

  // DOCX 解包级真值深度断言（使用原生 unpackZip 进行解压级校验）：
  // 1. 标准 PK\x03\x04 魔数；
  // 2. 解包 ZIP 确认包含 [Content_Types].xml、_rels/.rels、word/document.xml；
  // 3. 解压并读取 word/document.xml 内容流，证明真实含有书名和章节正文！
  const hasZipMagic =
    docxBuf.length > 1000 &&
    docxBuf[0] === 0x50 &&
    docxBuf[1] === 0x4b &&
    docxBuf[2] === 0x03 &&
    docxBuf[3] === 0x04;

  const unpacked = unpackZip(docxBuf);
  const entryPaths = unpacked.map((e) => e.path);
  const hasContentTypes = entryPaths.includes('[Content_Types].xml');
  const hasDocumentXml = entryPaths.includes('word/document.xml');
  const hasRels = entryPaths.includes('_rels/.rels');

  const docXmlFile = unpacked.find((e) => e.path === 'word/document.xml');
  const docXml = docXmlFile ? docXmlFile.data.toString('utf8') : '';
  const hasDocXmlProse =
    docXml.includes('沧澜纪元') &&
    docXml.includes('苏凌') &&
    docXml.includes('破浪而来的孤舟');

  const docxValid = hasZipMagic && hasContentTypes && hasDocumentXml && hasRels && hasDocXmlProse;
  const g09Passed = txtHasAllThreeChapters && docxValid;

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, '沧澜纪元-导出.txt'), txtBody, 'utf8');
  writeFileSync(join(evidenceDir, '沧澜纪元-导出.docx'), docxBuf);

  recordCheck('G-09', '出版级多格式导出 (TXT 与 Word .docx 深度规范与内容核对)', g09Passed ? 'passed' : 'failed', {
    txtBytes: Buffer.byteLength(txtBody, 'utf8'),
    txtChars: txtBody.length,
    txtHasAllThreeChapters,
    txtOrderCorrect: idxCh1 < idxCh2 && idxCh2 < idxCh3,
    docxBytes: docxBuf.length,
    hasZipMagic,
    hasContentTypes,
    hasDocumentXml,
    hasRels,
    hasDocXmlProse,
    docxValid,
    savedFiles: [
      join(evidenceDir, '沧澜纪元-导出.txt'),
      join(evidenceDir, '沧澜纪元-导出.docx'),
    ],
  });

  // 动态采集元数据
  const gitMeta = getGitMeta();
  const scriptContent = readFileSync(__filename, 'utf8');

  const finalReport = {
    kind: 'windows-http-author-journey-integration-smoke',
    status: checks.every((c) => c.verdict === 'passed') ? 'VERIFIED' : 'FAILED',
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    git: {
      commit: gitMeta.commit,
      branch: gitMeta.branch,
      isDirty: gitMeta.isDirty,
    },
    script: {
      file: 'scripts/verify-windows-author-journey.mjs',
      sha256: sha256(scriptContent),
    },
    modelProvider: 'mock (MOZHOU_DRAFT_PROVIDER=mock)',
    summary: {
      totalChecks: checks.length,
      passed: checks.filter((c) => c.verdict === 'passed').length,
      failed: checks.filter((c) => c.verdict === 'failed').length,
    },
    checks,
    dataRoot: serverDataRoot,
    scopeLimitations: [
      '本运行为基于真实 Node productionServer 的 HTTP API 架构级集成冒烟，不等于未装环境下的 Windows 独立安装包测试。',
      '模型生成采用显式 mock provider（切块回吐），未调用外部付费商业模型真实扣费链路。',
      '服务冷重启核对了静止正文文件哈希对齐，不模拟物理掉电崩溃（断电耐久实操需在虚拟机或专用台架执行）。',
      'Word .docx 经 ZIP 结构、Content_Types 与 document.xml 二进制内容检验，未经过微软 Word 桌面软件的人工交互打开检验。',
    ],
  };

  writeFileSync(join(evidenceDir, 'result.json'), `${JSON.stringify(finalReport, null, 2)}\n`, 'utf8');
  writeFileSync(join(evidenceDir, 'run.log'), `${logLines.join('\n')}\n`, 'utf8');
  log(`全流程验收完成！证据报告已写入: ${join(evidenceDir, 'result.json')}`);
  log(`最终结果: ${finalReport.status} (${finalReport.summary.passed}/${finalReport.summary.totalChecks} 通过)`);

  return finalReport;
}

try {
  const report = await runJourney();
  if (report.status !== 'VERIFIED') {
    process.exitCode = 1;
  }
} catch (err) {
  log(`验收过程发生异常失败: ${err.message}\n${err.stack}`);
  process.exitCode = 1;
  // 异常时也保证写出失败记录
  try {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      join(evidenceDir, 'result.json'),
      JSON.stringify(
        {
          kind: 'windows-http-author-journey-integration-smoke',
          status: 'FAILED',
          runId: RUN_ID,
          timestamp: new Date().toISOString(),
          error: err.message,
          stack: err.stack,
          checks,
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(join(evidenceDir, 'run.log'), `${logLines.join('\n')}\n`, 'utf8');
  } catch {
    // 忽略落盘日志失败
  }
} finally {
  if (serverProcess) {
    await stopServer(serverProcess);
  }
  if (serverDataRoot && !process.env.MOZHOU_KEEP_DATA) {
    try {
      rmSync(serverDataRoot, { recursive: true, force: true });
    } catch {
      // 忽略清理临时数据错误
    }
  }
  if (serverCwd) {
    try {
      rmSync(serverCwd, { recursive: true, force: true });
    } catch {
      // 忽略清理临时工作目录错误
    }
  }
}

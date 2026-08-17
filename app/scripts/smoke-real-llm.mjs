// A1（V1.1 Release Hardening）：真实 LLM 最小 smoke test。
// 链路：章节编辑 UI → chat API → 注入链 → 真实 LLM Provider(one-api) → SSE → AI 消息 → 消息持久化 → 刷新(重新 GET) → 插入正文 → 正文保存。
// 用法：从 app/ 目录运行 `node scripts/smoke-real-llm.mjs [--keep]`（需 one-api 在线 + app/.env 有 ONEAPI_TOKEN）。
// --keep：跑完后保留 dev server 与测试账号，供浏览器 UI 链路复验（打印端口与账号）。
// 不评价模型文字质量，只验证生产链路。失败即非零退出，绝不伪造 PASS。
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import postgres from "postgres";

process.loadEnvFile(".env");
const KEEP = process.argv.includes("--keep");

const pass = (...a) => console.log(`  ✓ ${a.join(" ")}`);
const fail = (...a) => {
  console.error(`  ✗ ${a.join(" ")}`);
  process.exitCode = 1;
};
const info = (...a) => console.log(`  · ${a.join(" ")}`);
let smokeEmail = null;
let auditSql = null;

async function cleanupSmokeTenant() {
  if (!smokeEmail || !process.env.DATABASE_URL) return;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`delete from users where email = ${smokeEmail}`;
    pass("清理 smoke 临时账号与作品", smokeEmail);
  } catch {
    info("无法自动清理 smoke 临时账号，请按邮箱手动删除", smokeEmail);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function readGenerationAudit(chapterId) {
  if (!auditSql) return null;
  try {
    const [job] = await auditSql`
      select job_id, status, error_class
      from generation_jobs
      where chapter_id = ${chapterId}
      order by id desc
      limit 1
    `;
    if (!job) return null;
    const attempts = await auditSql`
      select a.id as attempt_id, a.status, a.error_class, a.provider, a.model
      from generation_attempts a
      join generation_steps s on s.id = a.step_id
      where s.job_id = ${job.job_id}
      order by a.id
    `;
    const [ledger] = await auditSql`
      select id, request_id, task_id, attempt_id, source_class, provider, model,
             credential_owner, billing_owner, status, usage_status
      from usage_ledger
      where generation_id = ${job.job_id}
      order by id desc
      limit 1
    `;
    return {
      requestId: ledger?.request_id ?? job.job_id,
      taskId: ledger?.task_id ?? job.job_id,
      attemptId: ledger?.attempt_id ?? attempts.at(-1)?.attempt_id ?? null,
      boundaryEntered: attempts.length > 0 || Boolean(ledger),
      sourceClass: ledger?.source_class ?? null,
      provider: ledger?.provider ?? attempts.at(-1)?.provider ?? null,
      model: ledger?.model ?? attempts.at(-1)?.model ?? null,
      credentialOwner: ledger?.credential_owner ?? null,
      billingOwner: ledger?.billing_owner ?? null,
      terminalStatus: job.status,
      errorClass: job.error_class ?? attempts.at(-1)?.error_class ?? null,
      ledgerRecordId: ledger?.id ?? null,
      usageStatus: ledger?.usage_status ?? null,
      attemptCount: attempts.length,
    };
  } catch {
    return { auditUnavailable: true };
  }
}

async function pickFreePort() {
  const srv = createServer();
  await new Promise((r, j) => { srv.once("error", j); srv.listen(0, "127.0.0.1", r); });
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  return port;
}

// 剥离所有 mock provider 注入 → 走真实 one-api 链路
function realEnv() {
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  for (const k of [
    "CHAT_PROVIDER", "DISTILL_PROVIDER", "DECONSTRUCT_PROVIDER", "DRAW_PROVIDER",
    "SOURCE_PROVIDER", "WEBSEARCH_PROVIDER", "RANKINGS_PROVIDER", "SYNC_PROVIDER",
  ]) delete env[k];
  return env;
}

async function main() {
  const port = await pickFreePort();
  const base = `http://127.0.0.1:${port}`;
  info(`dev server 端口 ${port}`);

  const log = createWriteStream("tests/http/.smoke-real-llm.log", { flags: "w" });
  if (process.env.DATABASE_URL) auditSql = postgres(process.env.DATABASE_URL, { max: 1 });
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "-H", "127.0.0.1"],
    { cwd: process.cwd(), env: realEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const killTree = () => {
    if (child.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else child.kill("SIGTERM");
    }
  };

  try {
    // —— 1. 等待就绪 ——
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        // Next 16 项目级 dev server 锁：另有 dev server 存活时拒绝启动，错误信息含 PID/kill 命令
        let hint = "";
        try {
          const { readFileSync } = await import("node:fs");
          hint = readFileSync("tests/http/.smoke-real-llm.log", "utf8").split("\n").filter((l) => /already running|Local:|PID:|taskkill|kill /.test(l)).slice(-6).join("\n");
        } catch { /* 忽略 */ }
        throw new Error(`next dev 提前退出(code ${child.exitCode})${hint ? `\n${hint}` : "，见 tests/http/.smoke-real-llm.log"}`);
      }
      try { if ((await fetch(base)).status < 500) { ready = true; break; } } catch { /* 未就绪 */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("next dev 未在 120s 内就绪");
    info("server ready");

    // —— 2. 准备账号/作品/章节（模拟"章节编辑 UI"的保存动作）——
    const run = Date.now().toString(36);
    const email = `smoke-real-${run}@mozhou.local`;
    smokeEmail = email;
    const password = "smoke-test-1a2b3c";
    const reg = await fetch(`${base}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (reg.status !== 201) throw new Error(`注册失败 HTTP ${reg.status}`);
    const cookie = `mozhou_session=${reg.headers.get("set-cookie").match(/mozhou_session=([^;]+)/)[1]}`;
    pass("注册测试账号", email);

    const novel = await fetch(`${base}/api/v1/novels`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "真实链路冒烟书", requestKey: `smoke-${run}` }),
    });
    if (novel.status !== 201) throw new Error(`作品创建失败 HTTP ${novel.status}: ${(await novel.text()).slice(0, 200)}`);
    const { novel: n, chapter } = await novel.json();
    const body = "黄土坡上，老周把锄头抡起来。\n\n土腥气顺着风钻进鼻子里。";
    const saved = await fetch(`${base}/api/v1/novels/${n.id}/chapters?chapterId=${chapter.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: body }),
    });
    if (saved.status !== 200) throw new Error(`正文保存失败 HTTP ${saved.status}`);
    pass("作品/章节创建 + 正文保存（编辑 UI 侧动作）", `${body.length} 字`);

    // —— 3. chat API → 注入链（技能/正文上下文）→ 真实 LLM → SSE ——
    const t0 = Date.now();
    const chatRes = await fetch(`${base}/api/v1/novels/${n.id}/chapters/chat?chapterId=${chapter.id}`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "继续写一段：", skills: ["章节续写"] }),
    });
    if (chatRes.status !== 200) throw new Error(`chat HTTP ${chatRes.status}: ${(await chatRes.text()).slice(0, 200)}`);
    const sseText = await chatRes.text();
    const events = sseText.split("\n\n").filter((e) => e.startsWith("data:")).map((e) => JSON.parse(e.slice(5).trim()));
    const types = events.map((e) => e.type);
    const deltas = events.filter((e) => e.type === "delta" && e.text);
    const done = events.find((e) => e.type === "done");
    const err = events.find((e) => e.type === "error");
    const audit = await readGenerationAudit(chapter.id);
    info("REAL_SMOKE_TRACE", JSON.stringify({
      httpStatus: chatRes.status,
      eventSequence: types,
      streamStarted: types.includes("start"),
      firstDeltaReceived: deltas.length > 0,
      terminalEvent: types.at(-1) ?? null,
      errorCode: err?.code ?? null,
      generationId: done?.generationId ?? audit?.requestId ?? null,
      audit,
    }));
    if (err) throw new Error(`SSE error{code}: ${err.code}（${err.message ?? ""}）`);
    if (!done?.messageId) throw new Error(`SSE 无 done{messageId}，事件序列: ${types.join(",")}`);
    const aiText = deltas.map((d) => d.text).join("");
    if (!aiText.trim()) throw new Error("SSE 无真实文本 delta");
    const ms = Date.now() - t0;
    pass("SSE 正常结束", `start/delta×${deltas.length}/done，耗时 ${ms}ms，真实文本 ${aiText.length} 字`);
    info("AI 文本预览:", aiText.slice(0, 60).replace(/\n/g, "⏎"));
    info("（技能/正文上下文注入随请求成功发送，未造成请求错误）");

    // —— 4. 消息持久化 + 刷新后仍在 ——
    const list = await fetch(`${base}/api/v1/novels/${n.id}/chapters/messages?chapterId=${chapter.id}`, { headers: { cookie } });
    const { messages } = await list.json();
    const savedMsg = messages.find((m) => m.id === done.messageId);
    if (!savedMsg) throw new Error("刷新后消息不存在（持久化失败）");
    pass("AI 消息持久化 + 刷新后仍在", `messageId=${done.messageId}, ${savedMsg.content.length} 字`);

    // —— 5. AI 结果插入正文 + 正文真实保存 ——
    const ins = await fetch(`${base}/api/v1/novels/${n.id}/chapters/messages/${done.messageId}/insert?chapterId=${chapter.id}`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ mode: "original", target: { mode: "insert" } }),
    });
    if (ins.status !== 200) throw new Error(`插入失败 HTTP ${ins.status}: ${(await ins.text()).slice(0, 200)}`);
    const got = await fetch(`${base}/api/v1/novels/${n.id}/chapters?chapterId=${chapter.id}`, { headers: { cookie } });
    const { chapter: gotCh } = await got.json();
    if (!gotCh.content.endsWith(aiText)) throw new Error("插入后正文与 AI 文本不一致（正文未真实保存）");
    pass("AI 结果插入正文 + 正文真实保存", `正文 ${gotCh.content.length} 字，尾部与 AI 文本一致`);

    // —— 6. 汇总 ——
    console.log(`\nA1 SMOKE: PASS（真实 LLM 全链路 8 步全部成功，模型=one-api 默认 ${process.env.CHAT_PROVIDER ?? "（未覆盖，走真实）"}，注入链无错误）`);
    console.log(`端口=${port} 账号=${email} 密码=${password}`);
    if (KEEP) {
      info("--keep：server 保留，浏览器复验可直接使用上述端口/账号");
      return { port, email, password, base, novelId: n.id, chapterId: chapter.id };
    }
  } catch (err) {
    fail("A1 SMOKE: FAIL —", err.message);
    console.error("  证据：tests/http/.smoke-real-llm.log");
    if (KEEP) process.exit(1);
  } finally {
    if (auditSql) {
      await auditSql.end({ timeout: 5 }).catch(() => {});
      auditSql = null;
    }
    if (!KEEP) {
      killTree();
      await cleanupSmokeTenant();
      log.end();
    }
  }
}

await main();

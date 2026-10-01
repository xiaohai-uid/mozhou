/**
 * handoff-results/fixtures/controlled-upstream.mjs
 *
 * **受控上游测试替身**（明示：这不是模型，是本地 HTTP 夹具）。
 *
 * 形状：OpenAI 兼容 POST /v1/chat/completions，stream=true → text/event-stream。
 * 行为：先吐 2 个 delta，然后**故意挂住不再发**，直到客户端断开；断开时把
 *       connection_closed 事件（含时间戳与已发帧数）追加进 --record 指定的 JSON。
 *
 * 它存在的唯一原因：让「取消」这件事在**可控**条件下可观察——真实上游要么秒回
 * 要么不可控，无法证明「断开确实传到了上游」。报告里必须标明这是替身。
 */
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const PORT = Number(argOf('port', '0'));
const RECORD = argOf('record', null);
/** --complete：所有流都正常收尾（无需在提示词里塞控制词），用于「生成→采纳」路径。 */
const COMPLETE_ALL = args.includes('--complete');

const events = [];
if (RECORD) writeFileSync(RECORD, '[]\n', 'utf8');
function record(e) {
  const row = { at: new Date().toISOString(), tMs: Date.now() - T0, ...e };
  events.push(row);
  if (RECORD) writeFileSync(RECORD, JSON.stringify(events, null, 2) + '\n', 'utf8');
}
const T0 = Date.now();

const DELTAS = [
  '雾还没散。林舟把那枚黄铜罗盘',
  '翻过来，靛蓝色缺口贴着他的掌纹，凉得像刚从水里捞出来。',
];

const server = createServer((req, res) => {
  if (req.url === '/__ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, kind: 'controlled-test-double' }));
    return;
  }
  if (req.url === '/__events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(events));
    return;
  }
  // 兼容 /v1 前缀：应用会把 MOZHOU_API_BASE 拼成 <base>/chat/completions
  const isChat = req.url === '/v1/chat/completions' || req.url === '/chat/completions';
  if (!isChat) {
    record({ event: 'unexpected_path', url: req.url });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'controlled fixture: unexpected path ' + req.url } }));
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c.toString(); });
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    const stream = parsed.stream === true;
    record({ event: 'request_received', url: req.url, model: parsed.model ?? null, stream, authHeaderPresent: Boolean(req.headers.authorization) });
    res.writeHead(200, {
      'Content-Type': stream ? 'text/event-stream; charset=utf-8' : 'application/json',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    if (!stream) {
      res.end(JSON.stringify({ id: 'chatcmpl-fixture', choices: [{ message: { role: 'assistant', content: DELTAS.join('') }, finish_reason: 'stop' }] }));
      return;
    }
    let i = 0;
    let closed = false;
    let emitted = 0;
    // 提示词带 __COMPLETE__ 时，发完 2 个 delta 就正常收尾（[DONE] + end）；
    // 否则**故意挂住**，模拟「上游还在生成」。
    const promptText = typeof parsed.messages === 'undefined' ? '' : JSON.stringify(parsed.messages);
    const shouldComplete = COMPLETE_ALL || promptText.includes('__COMPLETE__') || promptText.includes('__HOLD__');
    // __HOLD__：第二个 delta 与收尾都推迟到客户端断开之后，专门逼出
    // 「服务端向已销毁响应写 done 帧」这条缝。
    const holdMs = promptText.includes('__HOLD__') ? 2500 : 60;
    let liveTimer = null;
    req.on('aborted', () => record({ event: 'request_aborted', emittedFrames: emitted }));
    let finishedNaturally = false;
    res.on('close', () => {
      if (closed) return;
      closed = true;
      record({ event: finishedNaturally ? 'stream_completed' : 'connection_closed', emittedFrames: emitted, finishedNaturally });
      if (liveTimer !== null) clearInterval(liveTimer);
    });
    const send = (delta) => {
      if (closed) return;
      res.write('data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', model: 'controlled-fixture', choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] }) + '\n\n');
      emitted += 1;
      record({ event: 'delta_sent', index: emitted, chars: delta.length });
    };
    send(DELTAS[0]);
    liveTimer = setInterval(() => {
      if (i === 0) {
        send(DELTAS[1]);
        i += 1;
        if (shouldComplete) {
          setTimeout(() => {
            if (closed) return;
            finishedNaturally = true;
            res.write('data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', model: 'controlled-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
          }, holdMs);
        }
        return;
      }
      // 之后保持沉默：不发数据帧、不结束响应（模拟「上游还在生成」）
    }, 60);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('controlled-upstream listening on 127.0.0.1:' + server.address().port + '\n');
});

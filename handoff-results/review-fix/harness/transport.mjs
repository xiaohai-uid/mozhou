/**
 * harness/transport.mjs —— 真实通道的**唯一**发放入口（额度 + 门禁 + 记账 三合一）。
 *
 * 为什么单独成模块：Codex 复核指出 runner 里存在多处各自发请求的路径
 * （B 阶段一处、C-real 一处、C-control 曾误配一处），任何一处漏检都等于预算失效。
 * 现在所有真实上游请求必须经过 guardedSend()，它做三件事且顺序不可颠倒：
 *
 *   1. channel 判别：只有 channel==='real' 才可能发真实请求；'controlled' 一律拒绝；
 *   2. **先 spendRealCall() 原子持久化占用**（失败/取消/429 都不退款）；
 *   3. 拿到 reservationId 之后才真正调用 transport()。
 *
 * transport 由调用方注入 ⇒ 离线测试可以用假 transport 完整验证门禁，
 * 不需要任何真实网络。
 */
import { spendRealCall } from './accounting.mjs';

export class ChannelRefusedError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ChannelRefusedError';
    this.detail = detail ?? null;
  }
}

/**
 * @param {object} opts
 * @param {'real'|'controlled'} opts.channel
 * @param {string} opts.ticketDir
 * @param {string} opts.reason            这次真实调用的用途（进账本，必填）
 * @param {string|null} opts.runDir
 * @param {(reservation)=>Promise<any>} opts.transport 真正发请求的函数
 * @returns {Promise<{result:any, reservation:object}>}
 */
export async function guardedSend(opts) {
  const { channel, ticketDir, reason, runDir = null, transport } = opts;
  if (typeof transport !== 'function') throw new TypeError('guardedSend: transport 必须是函数');
  if (channel !== 'real' && channel !== 'controlled') {
    throw new ChannelRefusedError('guardedSend: channel 必须是 real 或 controlled，收到 ' + String(channel));
  }
  if (channel === 'controlled') {
    // 受控替身**不允许**占用真实额度：占用了就是账目污染。
    const result = await transport(null);
    return { result, reservation: null };
  }
  // 唯一授权点。抛错（额度用尽 / 账本损坏 / 锁超时 / 非法预算）⇒ 请求根本不发出。
  const reservation = spendRealCall(ticketDir, { reason, runDir, channel });
  try {
    const result = await transport(reservation);
    return { result, reservation };
  } finally {
    // 故意不退款：无论成功、失败、取消、429，占用都已持久化。
  }
}

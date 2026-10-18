/**
 * perf/k6/smoke.js —— 墨舟最小性能冒烟（K6）。
 *
 * 定位：**冒烟，不是基准**。它回答一个问题——「服务在常驻负载下还活着吗」，
 * 而不是「今天比昨天快多少」。基准要固定负载、固定机器、多次取中位数，
 * 那是后续独立话题，本脚本刻意不做（避免把一次性数字当成性能结论）。
 *
 * 负载刻意保守：10 VU × 30 秒，全打只读端点。理由是这是要能进 nightly 的
 * 冒烟——写端点会把测试数据写进数据根，一次 nightly 下来污染真实书稿目录；
 * 只读端点不碰状态，跑完即走。
 *
 * 阈值（本地跑不通就应该红，不设「参考值」糊弄）：
 *   - p(95) < 500ms：只读端点 500ms 已是宽松线，超了说明有问题；
 *   - http_req_failed < 1%：冒烟允许偶发失败，系统性失败必须红。
 *
 * 用法（先起服务，见同目录 run-smoke.mjs）：
 *   k6 run perf/k6/smoke.js -e BASE_URL=http://127.0.0.1:5198
 */
import { check, sleep } from 'k6'
import http from 'k6/http'
import { Rate, Trend } from 'k6/metrics'

export const options = {
  vus: Number(__ENV.VUS ?? 10),
  duration: __ENV.DURATION ?? '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

// 分端点趋势：总 p95 会把慢端点淹在快端点的量里，分开记才看得出是哪个在拖。
const healthDuration = new Trend('health_duration', true)
const capabilityDuration = new Trend('capability_duration', true)
const catalogDuration = new Trend('catalog_duration', true)
const errorRate = new Rate('endpoint_error_rate')

const BASE_URL = __ENV.BASE_URL ?? 'http://127.0.0.1:5198'

export default function () {
  // /api/health：最轻的就绪探针，任何回归都会先在这里露头。
  {
    const res = http.get(`${BASE_URL}/api/health`)
    const ok = res.status === 200
    healthDuration.add(res.timings.duration)
    errorRate.add(!ok)
    check(res, { 'health status 200': (r) => r.status === 200 })
  }

  // /api/capability-square：读侧聚合端点，涉及能力目录装配，比 health 重一档。
  // **必须是 POST**：systemRoutes 的入口门禁只对 GET 放行 membership 与
  // billing/catalog，capability-square 虽是纯读，但按 POST 分支放行
  // （apps/web/server/routes/systemRoutes.ts 的 method+path 白名单）。
  // 用 GET 打会 404——压测会拿到漂亮的 1ms「延迟」，其实是请求根本没进业务。
  {
    const res = http.post(`${BASE_URL}/api/capability-square`, null, {
      headers: { 'Content-Type': 'application/json' },
    })
    const ok = res.status === 200
    capabilityDuration.add(res.timings.duration)
    errorRate.add(!ok)
    check(res, { 'capability-square status 200': (r) => r.status === 200 })
  }

  // /api/billing/catalog：静态目录，理论上最快；它慢说明是传输/中间件层的问题，
  // 而不是业务逻辑——是很好的「对照组」。
  {
    const res = http.get(`${BASE_URL}/api/billing/catalog`)
    const ok = res.status === 200
    catalogDuration.add(res.timings.duration)
    errorRate.add(!ok)
    check(res, { 'billing/catalog status 200': (r) => r.status === 200 })
  }

  sleep(0.1)
}

// 测试全局启动：拉起真实 next dev server（契约测试走真实 HTTP，符合「只测外部行为」哲学）
// A3（V1.1 Release Hardening）：改用「临时空闲端口」+ 端口文件握手，消除 3100 孤儿进程污染。
// 固定端口被孤儿进程占位时，新 child 绑定失败但 readiness 轮询会命中孤儿 → 测试跑到残缺 env 的 server 上。
// 现在每次运行探测空闲端口，端口写入 tests/http/.test-port，由 setup-env.ts 在每个 worker 内注入 TEST_BASE_URL。
// 开发者手动运行的 dev server（无论哪个端口）不受影响。
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/** 探测一个当前空闲的本地端口（bind :0 → 关闭 → 复用该端口号） */
async function pickFreePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  const port = (srv.address() as { port: number }).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

export default async function setup() {
  const port = Number(process.env.TEST_PORT ?? 0) || (await pickFreePort());
  const base = `http://127.0.0.1:${port}`;
  const portFile = join(process.cwd(), "tests/http/.test-port");
  const observerFile = join(process.cwd(), "tests/http/.payload-observer.jsonl");
  try {
    unlinkSync(observerFile);
  } catch {
    // Previous interrupted runs may not have left a capture file.
  }

  // 直接用 node 跑 next 的 bin（Windows 下 spawn .cmd 会 EINVAL，且避免 shell 层）
  const log = createWriteStream("tests/http/.next-dev.log", { flags: "w" });
  let child: ChildProcess | null = null;
  const killTree = () => {
    if (child?.pid) {
      // Windows 需按进程树杀（node 可能派生子进程）
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } else {
        child.kill("SIGTERM");
      }
    }
  };

  try {
    child = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "-H", "127.0.0.1"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test", // 让 Capturing Provider 满足唯一的测试环境门
          NEXT_TELEMETRY_DISABLED: "1",
          CHAT_PROVIDER: "mock", // 契约测试注入 mock LLM（确定性，不依赖外网）
          CHAT_OBSERVER_FILE: observerFile, // 测试 worker 读取的脱敏 observer 证据桥
          DISTILL_PROVIDER: "mock", // 风格蒸馏同样 mock（07 工单）
          DECONSTRUCT_PROVIDER: "mock", // 小说拆解同样 mock（09 工单）
          DRAW_PROVIDER: "mock", // 抽卡模式同样 mock（10 工单）
          SOURCE_PROVIDER: "mock", // 书源引擎同样 mock（08 工单，外部源不可达的确定性表现）
          WEBSEARCH_PROVIDER: "mock", // 联网搜索 mock（任务二-C）
          RANKINGS_PROVIDER: "mock", // 网文扫榜 mock（任务二-C）
          SYNC_PROVIDER: "mock", // 云同步 mock（任务二-C）
          FANQIE_SEARCH_MOCK: "1", // 番茄搜索强制降级（source.test.ts 确定性，工单 08 收尾）
          RATE_LIMIT_AI_PER_MIN: "100000", // 契约套件单用户高频调用，不得被 AI 限流截断（登录限流保持真实值并被专项测试）
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);

    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        // 常见快速失败：Next 16 项目级 dev server 锁（另有 dev server 存活时，新 server 拒绝启动并打出含 PID/kill 命令的信息）
        let hint = "";
        try {
          const { readFileSync } = await import("node:fs");
          hint = readFileSync("tests/http/.next-dev.log", "utf8").split("\n").filter((l) => /already running|Local:|PID:|taskkill|kill /.test(l)).slice(-6).join("\n");
        } catch {
          // 日志不可读则忽略
        }
        throw new Error(
          `next dev 提前退出（code ${child.exitCode}）。${hint ? `\n${hint}` : `见 tests/http/.next-dev.log`}`,
        );
      }
      try {
        const res = await fetch(base);
        if (res.status < 500) {
          ready = true;
          break;
        }
      } catch {
        // 未就绪，继续轮询
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) {
      throw new Error(`next dev 未在 120s 内就绪（port ${port}），见 tests/http/.next-dev.log`);
    }

    // 端口握手先行：预热可能耗时数十秒，若预热后才写端口文件，
    // setup-env（worker 侧）可能读到上一轮残留端口（生产 gate 排查发现的竞态）。
    writeFileSync(portFile, String(port), "utf8");

    // 路由预热：Turbopack 首次请求触发编译，编译完成前请求可能 404（并发测试首次请求风暴竞态）。
    // 就绪后逐个触发核心 API 路由编译（未登录 401 即视为已注册），避免测试期间偶发 404。
    const warmRoutes = [
      "/api/v1/auth/register",
      "/api/v1/auth/login",
      "/api/v1/auth/logout",
      "/api/v1/account",
      "/api/v1/novels",
      "/api/v1/novels/bootstrap",
      "/api/v1/novels/import",
      "/api/v1/novels/0/start-writing",
      "/api/v1/novels/0/tracking",
      "/api/v1/novels/0",
      "/api/v1/novels/0/chapters",
      "/api/v1/novels/0/chapters/chat",
      "/api/v1/novels/0/chapters/messages",
      "/api/v1/novels/0/chapters/messages/0/insert",
      "/api/v1/novels/0/chapters/messages/0/discard",
      "/api/v1/novels/0/entries",
      "/api/v1/styles",
      "/api/v1/skills",
      "/api/v1/distill",
      "/api/v1/deconstruct/analyze",
      "/api/v1/deconstruct/runs",
      "/api/v1/deconstruct/runs/0/reference",
      "/api/v1/draw",
      "/api/v1/search",
      "/api/v1/shelf",
      "/api/v1/sessions",
      "/api/v1/sessions/0/messages",
      "/api/v1/websearch",
      "/api/v1/rankings",
      "/api/v1/sync/config",
      "/api/v1/sync/push",
      "/api/v1/tools/checks",
      "/api/v1/chat",
      "/api/v1/runtime/generations/0",
    ];
    // 每个 route 重试直到非 404（Turbopack 编译队列忙时首次请求可能 404 且不触发编译，
    // 重试可让编译队列空闲后的请求正常触发编译注册）
    for (const r of warmRoutes) {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const res = await fetch(`${base}${r}`, { method: "POST", body: "{}" });
          if (res.status !== 404) break; // 401/400/405 均视为 route 已注册
        } catch {
          // 网络错误重试
        }
        await new Promise((res) => setTimeout(res, 400));
      }
      await new Promise((res) => setTimeout(res, 100));
    }
  } catch (err) {
    killTree(); // 启动失败也必须清掉自己拉起的进程
    log.end();
    throw err;
  }

  return async () => {
    killTree();
    log.end();
    try {
      unlinkSync(portFile);
    } catch {
      // 文件不存在则忽略
    }
    try {
      unlinkSync(observerFile);
    } catch {
      // 捕获文件不存在则忽略
    }
  };
}

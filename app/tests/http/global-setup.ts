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
          NEXT_TELEMETRY_DISABLED: "1",
          CHAT_PROVIDER: "mock", // 契约测试注入 mock LLM（确定性，不依赖外网）
          DISTILL_PROVIDER: "mock", // 风格蒸馏同样 mock（07 工单）
          DECONSTRUCT_PROVIDER: "mock", // 小说拆解同样 mock（09 工单）
          DRAW_PROVIDER: "mock", // 抽卡模式同样 mock（10 工单）
          SOURCE_PROVIDER: "mock", // 书源引擎同样 mock（08 工单，外部源不可达的确定性表现）
          WEBSEARCH_PROVIDER: "mock", // 联网搜索 mock（任务二-C）
          RANKINGS_PROVIDER: "mock", // 网文扫榜 mock（任务二-C）
          SYNC_PROVIDER: "mock", // 云同步 mock（任务二-C）
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

    // 端口握手：worker 进程读不到本进程的 env，写文件由 setup-env.ts 注入 TEST_BASE_URL
    writeFileSync(portFile, String(port), "utf8");
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
  };
}

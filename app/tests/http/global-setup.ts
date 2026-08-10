// 测试全局启动：拉起真实 next dev server（契约测试走真实 HTTP，符合「只测外部行为」哲学）
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";

const PORT = Number(process.env.TEST_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess | null = null;

export default async function setup() {
  // 直接用 node 跑 next 的 bin（Windows 下 spawn .cmd 会 EINVAL，且避免 shell 层）
  const log = createWriteStream("tests/http/.next-dev.log", { flags: "w" });
  child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        CHAT_PROVIDER: "mock", // 契约测试注入 mock LLM（确定性，不依赖外网）
        DISTILL_PROVIDER: "mock", // 风格蒸馏同样 mock（07 工单）
        DECONSTRUCT_PROVIDER: "mock", // 小说拆解同样 mock（09 工单）
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
      throw new Error(`next dev 提前退出（code ${child.exitCode}），见 tests/http/.next-dev.log`);
    }
    try {
      const res = await fetch(BASE);
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
    throw new Error(`next dev 未在 120s 内就绪，见 tests/http/.next-dev.log`);
  }

  return async () => {
    if (child?.pid) {
      // Windows 需按进程树杀（node 可能派生子进程）
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } else {
        child.kill("SIGTERM");
      }
    }
    log.end();
  };
}

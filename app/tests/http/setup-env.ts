// A3（V1.1 Release Hardening）：端口文件握手。
// global-setup 在独立进程拉起 dev server（临时空闲端口）并把端口写入 tests/http/.test-port；
// 本文件在每个 worker 内于测试模块加载前把 TEST_BASE_URL 注入 process.env，
// 测试文件统一读 `process.env.TEST_BASE_URL ?? 3100`（零测试文件改动）。
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const port = readFileSync(join(process.cwd(), "tests/http/.test-port"), "utf8").trim();
  if (port) {
    process.env.TEST_BASE_URL = `http://127.0.0.1:${port}`;
  }
} catch {
  // 无握手文件（例如单跑 unit project）→ 保持默认 3100，不做任何事
}

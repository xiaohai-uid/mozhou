#!/usr/bin/env node
// report-coverage-status.mjs — 说明覆盖率当前为何跑不了，以及启用它需要什么。
//
// 现状：vitest.config.ts 已配好 coverage，但 @vitest/coverage-v8 未安装。
// 因此 pnpm exec vitest run --coverage 会报 MISSING DEPENDENCY。
// 本脚本把这个事实变成可执行的检查，而不是留一个必然失败的 npm script。
import { existsSync, readFileSync } from "node:fs";

const problems = [];

if (!existsSync("vitest.config.ts")) problems.push("vitest.config.ts 不存在。");
else {
  const v = readFileSync("vitest.config.ts", "utf8");
  if (!v.includes("coverage")) problems.push("vitest.config.ts 未配置 coverage 段。");
}

const hasProvider = existsSync("node_modules/@vitest/coverage-v8");
if (!hasProvider) {
  console.log("覆盖率状态：**未启用**");
  console.log("");
  console.log("  vitest.config.ts 已配好 coverage 段，但 @vitest/coverage-v8 未安装。");
  console.log("  直接跑 vitest --coverage 会报 MISSING DEPENDENCY。");
  console.log("");
  console.log("  启用它需要：pnpm add -D @vitest/coverage-v8");
  console.log("  本仓库刻意未擅自添加该依赖——它会改动 pnpm-lock.yaml 并引入供应链变更，需要显式授权。");
  console.log("");
  console.log("  启用后请把实测数字回填到 docs/gates.md，并据此决定阈值（当前刻意未设阈值）。");
} else {
  console.log("覆盖率状态：**已启用**");
  console.log("  运行：pnpm exec vitest run --coverage");
}

if (problems.length) {
  problems.forEach((p) => console.log("  FAIL " + p));
  process.exit(1);
}
process.exit(0);

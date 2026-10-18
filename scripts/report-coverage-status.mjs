#!/usr/bin/env node
// report-coverage-status.mjs — 覆盖率配置完整性检查。
//
// 定位：只检查两侧 vitest 配置、provider 安装与版本对齐；真实数值和阻断结论
// 由 `pnpm run test:coverage:packages` / `test:coverage:web` 产出。
// 本脚本不读取 coverage-summary.json，避免旧报告冒充本轮结果。
import { existsSync, readFileSync } from "node:fs";

const problems = [];
const layers = [
  { name: "packages", config: "vitest.config.ts", providerRoot: "node_modules", reportDir: "coverage/packages" },
  { name: "web", config: "apps/web/vitest.config.ts", providerRoot: "apps/web/node_modules", reportDir: "coverage/web" },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkConfig(layer) {
  if (!existsSync(layer.config)) {
    problems.push(`${layer.name}: ${layer.config} 不存在`);
    return;
  }
  const text = readFileSync(layer.config, "utf8");
  for (const key of ["provider", "include", "exclude", "thresholds", "perFile", "autoUpdate", "reportsDirectory"]) {
    if (!text.includes(key)) problems.push(`${layer.name}: ${layer.config} 缺少 ${key}`);
  }
  if (!/provider:\s*['"]v8['"]/.test(text)) problems.push(`${layer.name}: provider 不是 v8`);
  if (!/perFile:\s*false/.test(text)) problems.push(`${layer.name}: perFile 必须为 false`);
  if (!/autoUpdate:\s*false/.test(text)) problems.push(`${layer.name}: autoUpdate 必须为 false`);
  if (!text.includes(layer.reportDir)) problems.push(`${layer.name}: reportsDirectory 未指向 ${layer.reportDir}`);

  const block = text.match(/thresholds:\s*\{([\s\S]*?)\}/);
  if (!block) {
    problems.push(`${layer.name}: thresholds 不是显式对象`);
    return;
  }
  for (const key of ["lines", "statements", "functions", "branches"]) {
    const m = block[1].match(new RegExp(`${key}:\\s*([0-9.]+)`));
    if (!m) {
      problems.push(`${layer.name}: thresholds.${key} 缺失`);
      continue;
    }
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      problems.push(`${layer.name}: thresholds.${key}=${m[1]} 不是 0..100 的有限数`);
    }
  }
}

function checkProvider(layer) {
  const providerPkg = `${layer.providerRoot}/@vitest/coverage-v8/package.json`;
  const vitestPkg = `${layer.providerRoot}/vitest/package.json`;
  if (!existsSync(providerPkg)) {
    problems.push(`${layer.name}: @vitest/coverage-v8 未安装（${providerPkg}）`);
    return;
  }
  if (!existsSync(vitestPkg)) {
    problems.push(`${layer.name}: vitest 未安装（${vitestPkg}）`);
    return;
  }
  const providerVersion = readJson(providerPkg).version;
  const vitestVersion = readJson(vitestPkg).version;
  if (providerVersion !== vitestVersion) {
    problems.push(`${layer.name}: provider ${providerVersion} 与 vitest ${vitestVersion} 版本不一致`);
  }
}

for (const layer of layers) {
  checkConfig(layer);
  checkProvider(layer);
}

if (problems.length) {
  console.log("覆盖率配置：**不完整**");
  problems.forEach((p) => console.log("  FAIL " + p));
  process.exit(1);
}

console.log("覆盖率配置：**完整**（packages + web，双套四维阈值，perFile=false，autoUpdate=false）");
console.log("真实数值与阻断：pnpm run test:coverage:packages / pnpm run test:coverage:web");
console.log("本脚本不读取旧报告；报告缺失或陈旧不会影响结论。");
process.exit(0);

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Docker 生产镜像（Dockerfile 用 .next/standalone）
  // E2E/dev: allow Playwright's 127.0.0.1 origin to load dev resources.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;

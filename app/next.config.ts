import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Docker 生产镜像（Dockerfile 用 .next/standalone）
};

export default nextConfig;

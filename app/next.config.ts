import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A/B diagnostic: use standard `next start` runtime instead of standalone.
  // E2E/dev: allow Playwright's 127.0.0.1 origin to load dev resources.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// 加载 app/.env（DATABASE_URL / AUTH_SECRET）
process.loadEnvFile();

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { TEST_BASE_URL: "http://127.0.0.1:3100" }, // 与 global-setup.ts 的 PORT 一致
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

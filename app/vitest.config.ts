import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// 加载 app/.env（DATABASE_URL / AUTH_SECRET）
process.loadEnvFile();

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // 两个 project：unit（纯函数，秒级无依赖）/ http（契约测试，globalSetup 拉起 dev server）
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "http",
          environment: "node",
          include: ["tests/http/**/*.test.ts"],
          globalSetup: ["tests/http/global-setup.ts"],
          env: { TEST_BASE_URL: "http://127.0.0.1:3100" }, // 与 global-setup.ts 的 PORT 一致
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});


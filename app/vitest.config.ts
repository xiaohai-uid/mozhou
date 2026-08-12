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
          // HTTP tests share one real Next server and its observer sink;
          // serialize files so observations cannot cross test boundaries.
          fileParallelism: false,
          maxWorkers: 1,
          globalSetup: ["tests/http/global-setup.ts"],
          setupFiles: ["tests/http/setup-env.ts"], // A3：从 .test-port 握手注入 TEST_BASE_URL（动态端口）
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});

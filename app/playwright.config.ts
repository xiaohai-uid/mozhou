import { defineConfig } from "@playwright/test";

// MoZhou E2E: real browser regression.
// Default: fast `next dev` for local debugging.
// Set E2E_PROD=1 to run against the production build (`next build` + `next start`).
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IS_PROD = process.env.E2E_PROD === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: IS_PROD ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    cwd: __dirname,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env as Record<string, string>,
      NODE_ENV: "test",
      CHAT_PROVIDER: "mock",
      DISTILL_PROVIDER: "mock",
      DECONSTRUCT_PROVIDER: "mock",
      DRAW_PROVIDER: "mock",
      SOURCE_PROVIDER: "mock",
      WEBSEARCH_PROVIDER: "mock",
      RANKINGS_PROVIDER: "mock",
      SYNC_PROVIDER: "mock",
      FANQIE_SEARCH_MOCK: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser", testMatch: "openapi.spec.ts", workers: 1, timeout: 90_000,
  outputDir: ".local/api-browser-results", reporter: "line",
  use: { baseURL: process.env.SMOKE_ORIGIN ?? "http://localhost:3001", channel: process.env.SMOKE_BROWSER ?? "msedge",
    headless: true, viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure" },
});
